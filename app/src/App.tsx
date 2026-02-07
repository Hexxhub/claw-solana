import { useMemo, useState, useCallback, useEffect } from 'react'
import { ConnectionProvider, WalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react'
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js'
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor'
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token'
import _IDL from './idl.json'
const IDL = _IDL as any
import '@solana/wallet-adapter-react-ui/styles.css'

const PROGRAM_ID = new PublicKey('QiAZtS7YfibVDTTarBM8bXfCtPFaMJ24BwSijZHg9W8')
const USDC_DEVNET = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const DEVNET_RPC = 'https://api.devnet.solana.com'

interface ClawVault {
  publicKey: PublicKey
  account: {
    funder: PublicKey
    tokenMint: PublicKey
    tokenAccount: PublicKey
    maxAmount: BN
    spentAmount: BN
    expiry: BN | null
    clawNftMint: PublicKey
    bump: number
    isActive: boolean
  }
}

function useProgram() {
  const { connection } = useConnection()
  const wallet = useWallet()

  return useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction) return null
    const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' })
    return new Program(IDL as any, provider)
  }, [connection, wallet])
}

function getVaultPDA(funder: PublicKey, tokenMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('claw_vault'), funder.toBuffer(), tokenMint.toBuffer()],
    PROGRAM_ID
  )
}

function shortenAddress(addr: string, chars = 4): string {
  return `${addr.slice(0, chars)}...${addr.slice(-chars)}`
}

function formatAmount(amount: BN, decimals = 6): string {
  const num = amount.toNumber() / Math.pow(10, decimals)
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Hero ────────────────────────────────────────────────────────────────────

function HeroSection({ vaultCount }: { vaultCount: number | null }) {
  return (
    <div className="bg-gradient-to-b from-red-950/40 via-red-950/10 to-transparent pt-8 pb-20">
      <header className="max-w-5xl mx-auto px-4 sm:px-6 flex justify-between items-center mb-12">
        <div className="flex items-center gap-3">
          <span className="text-5xl">🦞</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Claw</h1>
            <p className="text-gray-400 text-sm hidden sm:block">Bounded Spending on Solana</p>
          </div>
        </div>
        <WalletMultiButton />
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
        <h2 className="text-3xl sm:text-5xl font-bold mb-5 leading-tight">
          Give agents money.<br />
          <span className="text-red-500">Not your keys.</span>
        </h2>
        <p className="text-lg sm:text-xl text-gray-400 max-w-2xl mx-auto mb-8">
          Claw creates on-chain spending vaults for AI agents. Set a USDC limit, grant an NFT key, and let agents spend autonomously. Unused funds return to you.
        </p>

        {vaultCount !== null && (
          <div className="inline-flex items-center gap-2 text-sm text-gray-400 mb-8">
            <span className="text-red-500 font-bold text-lg">{vaultCount}</span>
            <span>vaults created on Solana devnet</span>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3 text-sm">
          {[
            ['On-chain limits', "Can't be bypassed"],
            ['Recoverable', 'Burn to get USDC back'],
            ['NFT Authority', 'Standard SPL token'],
          ].map(([title, sub]) => (
            <div key={title} className="bg-gray-800/60 backdrop-blur rounded-xl px-4 py-2.5 border border-gray-700/50">
              <span className="text-red-500 font-bold">{title}</span>
              <span className="text-gray-400 ml-2 hidden sm:inline">{sub}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Create Vault ────────────────────────────────────────────────────────────

function CreateVault({ onCreated }: { onCreated: () => void }) {
  const program = useProgram()
  const { publicKey } = useWallet()
  const [amount, setAmount] = useState('')
  const [expiry, setExpiry] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    if (!program || !publicKey || !amount) return
    setLoading(true)
    setStatus(null)

    try {
      const maxAmount = new BN(parseFloat(amount) * 1e6)
      const tokenMint = USDC_DEVNET
      const [vaultPDA, bump] = getVaultPDA(publicKey, tokenMint)
      const vaultTokenAccount = await getAssociatedTokenAddress(tokenMint, vaultPDA, true)
      const funderTokenAccount = await getAssociatedTokenAddress(tokenMint, publicKey)
      const expiryVal = expiry ? new BN(Math.floor(new Date(expiry).getTime() / 1000)) : null

      // Create vault
      setStatus('Creating vault...')
      await (program.methods
        .createVault(maxAmount, expiryVal, bump) as any)
        .accounts({
          funder: publicKey,
          vault: vaultPDA,
          tokenMint,
          vaultTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc()

      // Fund vault
      setStatus('Funding vault...')
      await (program.methods
        .fundVault(maxAmount) as any)
        .accounts({
          funder: publicKey,
          vault: vaultPDA,
          funderTokenAccount,
          vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      setStatus('✅ Vault created and funded!')
      setAmount('')
      setExpiry('')
      onCreated()
    } catch (err: any) {
      console.error(err)
      setStatus(`❌ ${err.message?.slice(0, 100) || 'Transaction failed'}`)
    } finally {
      setLoading(false)
    }
  }, [program, publicKey, amount, expiry, onCreated])

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span>➕</span> Create Vault
      </h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Token Mint</label>
          <input
            type="text"
            value={USDC_DEVNET.toBase58()}
            disabled
            className="input w-full opacity-60 font-mono text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">USDC on Solana Devnet</p>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Max Amount (USDC) *</label>
          <input
            type="number"
            placeholder="100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-full"
            step="0.01"
            min="0"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Expiry (optional)</label>
          <input
            type="datetime-local"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="input w-full"
          />
          <p className="text-xs text-gray-500 mt-1">Leave empty for no expiry</p>
        </div>

        <button
          onClick={handleCreate}
          disabled={!amount || loading || !publicKey}
          className="btn btn-primary w-full"
        >
          {loading ? '⏳ ' + (status || 'Processing...') : '🦞 Create & Fund Vault'}
        </button>

        {status && !loading && (
          <p className={`text-sm ${status.startsWith('✅') ? 'text-green-400' : status.startsWith('❌') ? 'text-red-400' : 'text-gray-400'}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Vault Card ──────────────────────────────────────────────────────────────

function VaultCard({ vault, onRefresh }: { vault: ClawVault; onRefresh: () => void }) {
  const program = useProgram()
  const { publicKey } = useWallet()
  const [showBurn, setShowBurn] = useState(false)
  const [burning, setBurning] = useState(false)

  const { account: v, publicKey: vaultKey } = vault
  const remaining = v.maxAmount.sub(v.spentAmount)
  const percentUsed = v.maxAmount.toNumber() > 0
    ? (v.spentAmount.toNumber() / v.maxAmount.toNumber()) * 100
    : 0
  const isExpired = v.expiry && v.expiry.toNumber() > 0 && Date.now() / 1000 > v.expiry.toNumber()
  const isFunder = publicKey && v.funder.equals(publicKey)

  const getStatusBadge = () => {
    if (!v.isActive) return <span className="badge badge-burned">Burned</span>
    if (isExpired) return <span className="badge badge-expired">Expired</span>
    return <span className="badge badge-active">Active</span>
  }

  const handleBurn = async () => {
    if (!program || !publicKey) return
    setBurning(true)
    try {
      const vaultTokenAccount = await getAssociatedTokenAddress(v.tokenMint, vaultKey, true)
      const funderTokenAccount = await getAssociatedTokenAddress(v.tokenMint, publicKey)

      await (program.methods
        .burnClaw() as any)
        .accounts({
          funder: publicKey,
          vault: vaultKey,
          vaultTokenAccount,
          funderTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      onRefresh()
    } catch (err: any) {
      console.error(err)
      alert(`Burn failed: ${err.message?.slice(0, 100)}`)
    } finally {
      setBurning(false)
      setShowBurn(false)
    }
  }

  return (
    <div className={`card transition-all hover:border-gray-700 ${!v.isActive ? 'opacity-60' : ''}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <a
            href={`https://explorer.solana.com/address/${vaultKey.toBase58()}?cluster=devnet`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-gray-300 hover:text-red-400 transition flex items-center gap-1"
          >
            {shortenAddress(vaultKey.toBase58(), 6)} ↗
          </a>
          <div className="mt-1">{getStatusBadge()}</div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-400">${formatAmount(remaining)}</p>
          <p className="text-xs text-gray-500">remaining</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-800 rounded-full h-2 mb-3">
        <div
          className="bg-gradient-to-r from-red-600 to-red-400 h-2 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(percentUsed, 100)}%` }}
        />
      </div>

      <div className="flex justify-between text-sm text-gray-400 mb-3">
        <span>${formatAmount(v.spentAmount)} spent</span>
        <span>${formatAmount(v.maxAmount)} limit</span>
      </div>

      <div className="pt-3 border-t border-gray-800 text-xs text-gray-500 space-y-1">
        <p>Mint: {shortenAddress(v.tokenMint.toBase58())}</p>
        {v.expiry && v.expiry.toNumber() > 0 && (
          <p>Expires: {new Date(v.expiry.toNumber() * 1000).toLocaleString()}</p>
        )}
        {v.clawNftMint && !v.clawNftMint.equals(PublicKey.default) && (
          <p>NFT: {shortenAddress(v.clawNftMint.toBase58())}</p>
        )}
      </div>

      {/* Burn action */}
      {isFunder && v.isActive && remaining.toNumber() > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-800">
          {showBurn ? (
            <div className="space-y-2">
              <p className="text-xs text-yellow-400">
                ⚠️ Burn to recover ${formatAmount(remaining)} USDC
              </p>
              <div className="flex gap-2">
                <button onClick={handleBurn} disabled={burning} className="btn btn-danger text-xs py-1.5 flex-1">
                  {burning ? '⏳ Burning...' : '🔥 Confirm Burn'}
                </button>
                <button onClick={() => setShowBurn(false)} className="btn btn-secondary text-xs py-1.5">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowBurn(true)} className="text-xs text-gray-400 hover:text-red-400 transition">
              🔥 Burn & Recover Funds
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── My Claws ────────────────────────────────────────────────────────────────

function MyClaws({ vaults, loading, onRefresh }: { vaults: ClawVault[]; loading: boolean; onRefresh: () => void }) {
  if (loading) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-4 animate-pulse">🦞</div>
        <p className="text-gray-400">Loading vaults...</p>
      </div>
    )
  }

  if (vaults.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="text-4xl mb-4">🦞</div>
        <p className="text-gray-300 font-medium">No vaults yet</p>
        <p className="text-sm text-gray-500 mt-1">Create one to fund an agent with spending authority</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {vaults.map((v) => (
        <VaultCard key={v.publicKey.toBase58()} vault={v} onRefresh={onRefresh} />
      ))}
    </div>
  )
}

// ─── Spend Section ───────────────────────────────────────────────────────────

function SpendSection() {
  const program = useProgram()
  const { publicKey } = useWallet()
  const [vaultAddress, setVaultAddress] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSpend = useCallback(async () => {
    if (!program || !publicKey || !vaultAddress || !recipient || !amount) return
    setLoading(true)
    setStatus(null)

    try {
      const vaultKey = new PublicKey(vaultAddress)
      const recipientKey = new PublicKey(recipient)
      const vaultData = await (program.account as any).clawVault.fetch(vaultKey)
      const tokenMint = vaultData.tokenMint as PublicKey

      const vaultTokenAccount = await getAssociatedTokenAddress(tokenMint, vaultKey, true)
      const recipientTokenAccount = await getAssociatedTokenAddress(tokenMint, recipientKey)

      // Find spender's claw NFT account
      const clawMint = vaultData.clawNftMint as PublicKey
      const spenderClawAccount = await getAssociatedTokenAddress(clawMint, publicKey)

      const spendAmount = new BN(parseFloat(amount) * 1e6)

      await (program.methods
        .spend(spendAmount, memo || null) as any)
        .accounts({
          spender: publicKey,
          vault: vaultKey,
          spenderClawAccount,
          vaultTokenAccount,
          recipientTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()

      setStatus('✅ Spend successful!')
      setAmount('')
      setMemo('')
    } catch (err: any) {
      console.error(err)
      setStatus(`❌ ${err.message?.slice(0, 100) || 'Transaction failed'}`)
    } finally {
      setLoading(false)
    }
  }, [program, publicKey, vaultAddress, recipient, amount, memo])

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span>💸</span> Spend from Vault
      </h3>
      <p className="text-sm text-gray-400 mb-4">
        For agents holding a Claw NFT. Spend USDC from the vault to any recipient.
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Vault Address *</label>
          <input
            type="text"
            placeholder="Vault public key..."
            value={vaultAddress}
            onChange={(e) => setVaultAddress(e.target.value)}
            className="input w-full font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Recipient *</label>
          <input
            type="text"
            placeholder="Recipient wallet address..."
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="input w-full font-mono text-sm"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Amount (USDC) *</label>
          <input
            type="number"
            placeholder="10"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input w-full"
            step="0.01"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Memo (optional)</label>
          <input
            type="text"
            placeholder="Payment for API usage..."
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="input w-full"
          />
        </div>

        <button
          onClick={handleSpend}
          disabled={!vaultAddress || !recipient || !amount || loading || !publicKey}
          className="btn btn-primary w-full"
        >
          {loading ? '⏳ Processing...' : '💸 Spend'}
        </button>

        {status && (
          <p className={`text-sm ${status.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Info Panel ──────────────────────────────────────────────────────────────

function InfoPanel() {
  return (
    <div className="space-y-4">
      <div className="card bg-gradient-to-br from-gray-800/80 to-gray-900/80">
        <h3 className="font-semibold mb-3">💡 How it works</h3>
        <ol className="text-sm text-gray-400 space-y-2.5">
          <li className="flex gap-2"><span className="text-red-500 font-bold">1.</span> Create a vault with a USDC spending limit</li>
          <li className="flex gap-2"><span className="text-red-500 font-bold">2.</span> Fund the vault with USDC tokens</li>
          <li className="flex gap-2"><span className="text-red-500 font-bold">3.</span> Mint a Claw NFT to your agent's wallet</li>
          <li className="flex gap-2"><span className="text-red-500 font-bold">4.</span> Agent spends up to the limit autonomously</li>
          <li className="flex gap-2"><span className="text-red-500 font-bold">5.</span> Burn anytime to recover unused USDC</li>
        </ol>
      </div>

      <div className="card bg-red-950/30 border-red-900/50">
        <h3 className="font-semibold mb-2 text-red-400">⚠️ Devnet Only</h3>
        <p className="text-sm text-gray-400">
          This app runs on Solana Devnet. Get test USDC from the{' '}
          <a href="https://faucet.circle.com/" className="text-red-400 hover:underline" target="_blank" rel="noopener noreferrer">
            Circle Faucet
          </a>
          .
        </p>
      </div>

      <div className="card">
        <h3 className="font-semibold mb-3">📜 Program</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-gray-400 shrink-0">Program</span>
            <a
              href={`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`}
              className="font-mono text-red-400 hover:underline truncate"
              target="_blank"
              rel="noopener noreferrer"
            >
              {shortenAddress(PROGRAM_ID.toBase58(), 6)}
            </a>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Network</span>
            <span>Solana Devnet</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Framework</span>
            <span>Anchor</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

function AppContent() {
  const { publicKey, connected } = useWallet()
  const { connection } = useConnection()
  const program = useProgram()
  const [activeTab, setActiveTab] = useState<'create' | 'claws' | 'spend'>('create')
  const [vaults, setVaults] = useState<ClawVault[]>([])
  const [vaultCount, setVaultCount] = useState<number | null>(null)
  const [loadingVaults, setLoadingVaults] = useState(false)

  const fetchVaults = useCallback(async () => {
    if (!program || !publicKey) return
    setLoadingVaults(true)
    try {
      const allVaults = await (program.account as any).clawVault.all()
      setVaultCount(allVaults.length)
      const myVaults = allVaults.filter((v: any) => v.account.funder.equals(publicKey))
      setVaults(myVaults)
    } catch (err) {
      console.error('Failed to fetch vaults:', err)
    } finally {
      setLoadingVaults(false)
    }
  }, [program, publicKey])

  // Fetch all vault count even without wallet
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const conn = new Connection(DEVNET_RPC, 'confirmed')
        const provider = new AnchorProvider(conn, { publicKey: PublicKey.default, signTransaction: async (t: any) => t, signAllTransactions: async (t: any) => t } as any, {})
        const prog = new Program(IDL as any, provider)
        const allVaults = await (prog.account as any).clawVault.all()
        setVaultCount(allVaults.length)
      } catch (err) {
        console.error('Failed to fetch vault count:', err)
      }
    }
    fetchCount()
  }, [])

  useEffect(() => {
    if (connected) fetchVaults()
  }, [connected, fetchVaults])

  const tabs = [
    { id: 'create' as const, label: '➕ Create', icon: '' },
    { id: 'claws' as const, label: `🦞 My Claws (${vaults.length})`, icon: '' },
    { id: 'spend' as const, label: '💸 Spend', icon: '' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <HeroSection vaultCount={vaultCount} />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 w-full -mt-10 flex-1">
        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-xl font-medium transition text-sm ${
                activeTab === tab.id
                  ? 'bg-red-600 text-white shadow-lg shadow-red-600/20'
                  : 'bg-gray-800/80 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!connected ? (
          <div className="card text-center py-16">
            <div className="text-5xl mb-4">🦞</div>
            <h2 className="text-xl font-semibold mb-3">Connect your wallet</h2>
            <p className="text-gray-400 mb-6">Connect a Solana wallet to create vaults and manage Claws.</p>
            <WalletMultiButton />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              {activeTab === 'create' && <CreateVault onCreated={fetchVaults} />}
              {activeTab === 'claws' && <MyClaws vaults={vaults} loading={loadingVaults} onRefresh={fetchVaults} />}
              {activeTab === 'spend' && <SpendSection />}
            </div>
            <InfoPanel />
          </div>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-4 sm:px-6 mt-16 py-8 border-t border-gray-800 text-center text-gray-500 text-sm w-full">
        <p>
          Built by{' '}
          <a href="https://github.com/Hexxhub" className="text-red-500 hover:underline">
            Hexx
          </a>{' '}
          🦞 | Colosseum Agent Hackathon
        </p>
        <p className="mt-2">
          <a href="https://github.com/Hexxhub/claw-solana" className="hover:text-white" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          {' • '}
          <a
            href={`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=devnet`}
            className="hover:text-white"
            target="_blank"
            rel="noopener noreferrer"
          >
            Explorer
          </a>
          {' • '}
          Solana Devnet
        </p>
      </footer>
    </div>
  )
}

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], [])

  return (
    <ConnectionProvider endpoint={DEVNET_RPC}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AppContent />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
