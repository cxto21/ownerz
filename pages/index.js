import { useState, useEffect, useCallback } from 'react'
import { encryptData, generateKeyPair, decryptData } from '../lib/encryption'
import { getAvailableWallets, connectWallet, isStrk20Capable, RpcProvider } from '../lib/starknet'
import { 
  privateTransfer, 
  batchPrivateTransfer,
  shieldTokens,
  getShieldedBalance,
  toSmallestUnit, 
  fromSmallestUnit,
  STRK_TOKEN_ADDRESS,
  formatTxHash,
  getExplorerUrl
} from '../lib/strk20-payments'
import { calculateUploadFee, getPricingInfo } from '../lib/fees'
import { createVault, claimVault, getVault, getPrice, cidToFelt, deployContract } from '../lib/filevault'
import { wrapKeySeed, unwrapKeySeed } from '../lib/encryption'
import { hash as snHash } from 'starknet'
const computePedersenHash = snHash.computePedersenHash

export default function Ownerz() {
  const [mode, setMode] = useState('sell')
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [showShieldModal, setShowShieldModal] = useState(false)
  const [showHackathonPopup, setShowHackathonPopup] = useState(true)
  const [walletState, setWalletState] = useState({
    connected: false,
    account: null,
    address: '',
    isStrk20: false,
    loading: false,
    error: null
  })

  // Check for wallet on mount
  useEffect(() => {
    const checkWallet = async () => {
      const wallets = await getAvailableWallets()
      if (wallets.length === 0) {
        setWalletState(prev => ({ ...prev, error: 'No Starknet wallet detected' }))
      }
    }
    checkWallet()
  }, [])

  // Check network on connect
  useEffect(() => {
    if (!walletState.connected) return
    const checkNetwork = async () => {
      try {
        const provider = new RpcProvider({ nodeUrl: process.env.NEXT_PUBLIC_STARKNET_RPC || 'https://starknet-sepolia.public.blastapi.io/rpc/v0_8' })
        const chainId = await provider.getChainId()
        if (!chainId.includes('5345504f4c4941')) {
          setWalletState(prev => ({ ...prev, error: 'Please switch to Starknet Sepolia testnet' }))
        }
      } catch (e) {
        console.warn('Network check failed:', e)
      }
    }
    checkNetwork()
  }, [walletState.connected])

  const handleConnect = async () => {
    setWalletState(prev => ({ ...prev, loading: true, error: null }))
    
    try {
      const wallets = await getAvailableWallets()
      
      if (wallets.length === 0) {
        throw new Error('No Starknet wallet found. Install Ready extension.')
      }
      
      // Use first available wallet (in production, let user choose)
      const wallet = wallets[0]
      const result = await connectWallet(wallet)
      
      setWalletState({
        connected: true,
        account: result.account,
        address: result.address,
        isStrk20: result.isStrk20,
        loading: false,
        error: null
      })
    } catch (err) {
      setWalletState(prev => ({
        ...prev,
        loading: false,
        error: err.message
      }))
    }
  }

  const handleDisconnect = () => {
    setWalletState({
      connected: false,
      account: null,
      address: '',
      isStrk20: false,
      loading: false,
      error: null
    })
  }

  // Re-connect wallet to get a fresh account (needed after STRK20 operations)
  const refreshWallet = async () => {
    try {
      const wallets = await getAvailableWallets()
      if (wallets.length === 0) return
      const wallet = wallets[0]
      const result = await connectWallet(wallet)
      setWalletState(prev => ({
        ...prev,
        account: result.account,
        address: result.address,
        isStrk20: result.isStrk20,
      }))
      return result.account
    } catch (err) {
      console.warn('Wallet refresh failed:', err.message)
      return null
    }
  }

  return (
    <div className="dv">
      {/* Hackathon Popup */}
      {showHackathonPopup && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(20px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }} onClick={() => setShowHackathonPopup(false)}>
          <div style={{
            background: 'rgba(14, 14, 14, 0.9)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '40px',
            maxWidth: '480px',
            width: '100%',
            textAlign: 'center',
            position: 'relative'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '20px',
              fontWeight: 700,
              color: 'var(--primary)',
              textTransform: 'uppercase',
              marginBottom: '16px'
            }}>
              Hackathon Build
            </div>
            <div style={{
              fontFamily: 'var(--font-body)',
              fontSize: '16px',
              color: 'rgba(255,255,255,0.5)',
              lineHeight: 1.6,
              marginBottom: '8px'
            }}>
              Work in progress for the <span style={{color:'var(--secondary-container)'}}>STRK20 Private Sprint</span> hackathon.
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'rgba(255,255,255,0.3)',
              marginBottom: '28px'
            }}>
              Starknet Sepolia Testnet · Do not use real funds
            </div>
            <button
              className="dv-btn-primary"
              onClick={() => setShowHackathonPopup(false)}
            >
              Enter
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <nav className="dv-nav">
        <div className="dv-nav-inner">
          <div className="dv-logo">OWNERZ</div>
          {walletState.connected ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              {walletState.isStrk20 ? (
                <span style={{
                  padding: '4px 8px',
                  background: 'rgba(4, 251, 251, 0.2)',
                  color: 'var(--secondary-container)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  STRK20 Ready
                </span>
              ) : (
                <span style={{
                  padding: '4px 8px',
                  background: 'rgba(255, 180, 171, 0.2)',
                  color: 'var(--error)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  No STRK20
                </span>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(walletState.address)
                  setCopiedAddress(true)
                  setTimeout(() => setCopiedAddress(false), 2000)
                }}
                title="Click to copy full address"
                style={{
                  padding: '8px 16px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: copiedAddress ? 'rgba(4, 251, 251, 0.2)' : 'transparent',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: copiedAddress ? 'var(--secondary-container)' : 'var(--secondary-container)',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {copiedAddress ? '✓ Copied' : `${walletState.address.slice(0,6)}...${walletState.address.slice(-4)}`}
              </button>
              <button
                onClick={() => setShowShieldModal(true)}
                title="Shield STRK to pool"
                style={{
                  padding: '8px 12px',
                  border: '1px solid rgba(220, 184, 255, 0.3)',
                  background: 'rgba(220, 184, 255, 0.1)',
                  color: 'var(--primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Shield
              </button>
              <button
                onClick={handleDisconnect}
                title="Disconnect wallet"
                style={{
                  padding: '8px 12px',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent',
                  color: 'rgba(255,255,255,0.4)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <button 
              onClick={handleConnect}
              disabled={walletState.loading}
              style={{
                padding: '12px 32px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: walletState.loading ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: 'white',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                cursor: walletState.loading ? 'wait' : 'pointer',
                transition: 'all 0.3s'
              }}
            >
              {walletState.loading ? 'Connecting...' : 'Connect Wallet ✦'}
            </button>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="dv-main">
        {/* Hero Section */}
        <section className="dv-hero">
          <div className="dv-hero-image">
            <img src="/images/brand-asset.png" alt="Ownerz Brand Asset" />
          </div>
          
          <div className="dv-hero-content">
            {/* Error Banner */}
            {walletState.error && (
              <div className="dv-error" style={{ marginBottom: '24px' }}>
                {walletState.error}
              </div>
            )}
            
            {/* STRK20 Warning */}
            {walletState.connected && !walletState.isStrk20 && (
              <div className="dv-info-box" style={{ marginBottom: '24px' }}>
                <strong>STRK20 not supported.</strong> Install Ready extension for private payments. 
                Current wallet: {walletState.address.slice(0,6)}...{walletState.address.slice(-4)}
              </div>
            )}
            
            <div className="dv-card">
              {/* Tabs */}
              <div className="dv-tabs">
                <button 
                  className={`dv-tab ${mode === 'sell' ? 'active' : ''}`}
                  onClick={() => setMode('sell')}
                >
                  Upload Data
                </button>
                <button 
                  className={`dv-tab ${mode === 'buy' ? 'active' : ''}`}
                  onClick={() => setMode('buy')}
                >
                  Access with CID
                </button>
              </div>

              {/* Card Content */}
              <div className="dv-card-content">
                {mode === 'sell' ? (
                  <SellFlow 
                    connected={walletState.connected} 
                    isStrk20={walletState.isStrk20}
                    account={walletState.account}
                    refreshWallet={refreshWallet}
                  />
                ) : (
                  <BuyFlow 
                    connected={walletState.connected}
                    isStrk20={walletState.isStrk20}
                    account={walletState.account}
                    refreshWallet={refreshWallet}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Deploy Section - Admin */}
      {walletState.connected && !process.env.NEXT_PUBLIC_FILEVAULT_ADDRESS && (
        <DeploySection account={walletState.account} refreshWallet={refreshWallet} />
      )}

      {/* Footer */}
      <footer className="dv-footer">
        Phase 1: Direct CID — Maximum Privacy
      </footer>

      {/* Shield Modal */}
      {showShieldModal && (
        <ShieldModal 
          account={walletState.account}
          onClose={() => setShowShieldModal(false)} 
        />
      )}
    </div>
  )
}

function ShieldModal({ account, onClose }) {
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState(0)
  const [error, setError] = useState(null)
  const [txHash, setTxHash] = useState(null)
  const [shieldedBalance, setShieldedBalance] = useState(null)

  const handleShield = async () => {
    if (!amount || !account) return
    setStep(1)
    setError(null)
    setShieldedBalance(null)

    try {
      const amountNum = parseFloat(amount)
      if (amountNum <= 0) throw new Error('Amount must be greater than 0')
      if (amountNum < 6) throw new Error('Minimum shield amount is 6 STRK')
      
      // Convert to hex (18 decimals)
      const amountHex = '0x' + BigInt(Math.round(amountNum * 1e18)).toString(16)
      
      const result = await shieldTokens(account, STRK_TOKEN_ADDRESS, amountHex)
      
      if (result.success) {
        setTxHash(result.transactionHash)
        // If timeout, show "possibly completed" state
        if (result.timeout) {
          setStep(3)
        } else {
          setStep(2)
        }
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      // If it's a timeout error, the shield may have worked anyway
      if (err.message && err.message.includes('timeout')) {
        console.log('Wallet timeout - shield may have succeeded, checking balance...')
        setStep(3) // "possibly completed" state
      } else {
        setError(err.message)
        setStep(0)
      }
    }
  }

  const checkShieldedBalance = async () => {
    try {
      const result = await getShieldedBalance(account, STRK_TOKEN_ADDRESS)
      if (result.success) {
        setShieldedBalance(result.message)
        if (result.balance && result.balance !== '0') {
          setStep(2) // Show success
          setTxHash(null) // No tx hash available
        }
      }
    } catch (err) {
      console.error('Balance check failed:', err)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="dv-card" style={{ maxWidth: '400px', width: '100%' }}>
        <div className="dv-card-content">
          {step === 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="dv-title">Shield STRK</h3>
                <button 
                  onClick={onClose}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: 'rgba(255,255,255,0.5)',
                    cursor: 'pointer',
                    fontSize: '20px'
                  }}
                >
                  ✕
                </button>
              </div>
              
              <p className="dv-hint">
                Deposit STRK into the privacy pool. Once shielded, you can make private transfers.
              </p>

              <div className="dv-input-group">
                <label>Amount (STRK)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="6.00"
                  min="6"
                  step="0.1"
                />
                <small>Minimum 6 STRK. Your wallet must be verified (Settings → Verify Account).</small>
              </div>

              <div style={{
                background: 'rgba(124, 58, 237, 0.1)',
                border: '1px solid rgba(124, 58, 237, 0.3)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px'
              }}>
                <p style={{color: 'var(--primary)', fontSize: '13px', margin: 0}}>
                  ⚠️ You will need to approve <strong>TWO transactions</strong> in your wallet:
                </p>
                <ol style={{color: 'rgba(255,255,255,0.7)', fontSize: '12px', margin: '8px 0 0 0', paddingLeft: '20px'}}>
                  <li>First: Approve the token spend (ERC-20 approve)</li>
                  <li>Second: Confirm the deposit to the pool</li>
                </ol>
              </div>

              {error && <div className="dv-error">{error}</div>}

              <button
                className="dv-btn-primary"
                onClick={handleShield}
                disabled={!amount}
              >
                Shield {amount || '0'} STRK
              </button>
            </>
          )}

          {step === 1 && (
            <div className="dv-loading">
              <div className="dv-spinner"></div>
              <p>Depositing to privacy pool...</p>
              <small style={{color: 'rgba(255,255,255,0.4)', marginTop: '8px'}}>
                Please approve both transactions in your wallet. The second one may take ~30 seconds for proof generation.
              </small>
            </div>
          )}

          {step === 2 && (
            <>
              <h3 className="dv-title">Shielded!</h3>
              
              <div className="dv-success-box">
                <p style={{color: 'var(--secondary-container)', marginBottom: '8px'}}>
                  {amount} STRK deposited to privacy pool
                </p>
                {txHash && (
                  <a 
                    href={getExplorerUrl(txHash)} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{color: 'var(--primary)', fontSize: '12px'}}
                  >
                    View on Explorer →
                  </a>
                )}
                {shieldedBalance && (
                  <p style={{color: 'var(--secondary-container)', marginTop: '8px', fontSize: '12px'}}>
                    {shieldedBalance}
                  </p>
                )}
              </div>

              <p className="dv-hint">
                You can now make private transfers and pay fees privately.
              </p>

              <div style={{
                background: 'rgba(0, 255, 136, 0.1)',
                border: '1px solid rgba(0, 255, 136, 0.3)',
                borderRadius: '8px',
                padding: '12px',
                marginTop: '12px'
              }}>
                <p style={{color: 'var(--secondary-container)', fontSize: '13px', margin: 0}}>
                  ⏱️ Note: Shielded funds take ~10 blocks (~20 minutes) to mature before they can be used for transfers.
                </p>
              </div>

              <button className="dv-btn-primary" onClick={onClose}>
                Done
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h3 className="dv-title">Processing...</h3>
              
              <div className="dv-loading">
                <p style={{color: 'var(--secondary-container)', marginBottom: '16px'}}>
                  The wallet didn't confirm, but your shield may have succeeded.
                </p>
                
                {shieldedBalance && (
                  <p style={{color: 'var(--secondary-container)', marginBottom: '16px'}}>
                    {shieldedBalance}
                  </p>
                )}
                
                <button 
                  className="dv-btn-secondary"
                  onClick={checkShieldedBalance}
                  style={{marginBottom: '12px'}}
                >
                  Check Shielded Balance
                </button>
                
                <button className="dv-btn-primary" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DeploySection({ account, refreshWallet }) {
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(false)
  const [error, setError] = useState(null)
  const [contractAddress, setContractAddress] = useState('')

  const handleDeploy = async () => {
    setDeploying(true)
    setError(null)

    try {
      const address = await deployContract(account)
      setContractAddress(address)
      setDeployed(true)
      
      // Show instructions to user
      alert(`Contract deployed!\n\nAddress: ${address}\n\nAdd this to your .env:\nNEXT_PUBLIC_FILEVAULT_ADDRESS=${address}\n\nThen restart the dev server.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeploying(false)
    }
  }

  if (deployed) {
    return (
      <div style={{
        padding: '20px',
        margin: '20px auto',
        maxWidth: '600px',
        background: 'rgba(16, 185, 129, 0.1)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
        borderRadius: '8px'
      }}>
        <h3 style={{color: '#10b981', margin: '0 0 10px 0', fontSize: '14px'}}>
          ✅ Contract Deployed
        </h3>
        <code style={{
          display: 'block',
          padding: '10px',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '4px',
          fontSize: '12px',
          wordBreak: 'break-all'
        }}>
          {contractAddress}
        </code>
      </div>
    )
  }

  return (
    <div style={{
      padding: '20px',
      margin: '20px auto',
      maxWidth: '600px',
      background: 'rgba(139, 92, 246, 0.1)',
      border: '1px dashed rgba(139, 92, 246, 0.3)',
      borderRadius: '8px',
      textAlign: 'center'
    }}>
      <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: '0 0 12px 0'}}>
        FileVault contract not deployed yet
      </p>
      
      {error && (
        <div style={{color: '#ef4444', fontSize: '12px', marginBottom: '12px'}}>
          {error}
        </div>
      )}

      <button
        onClick={handleDeploy}
        disabled={deploying}
        style={{
          padding: '10px 20px',
          background: deploying ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.8)',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: deploying ? 'wait' : 'pointer',
          fontSize: '13px',
          fontWeight: '600'
        }}
      >
        {deploying ? 'Deploying...' : 'Deploy FileVault Contract'}
      </button>
    </div>
  )
}

function SellFlow({ connected, isStrk20, account, refreshWallet }) {
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [price, setPrice] = useState('')
  const [step, setStep] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)
  const [feeInfo, setFeeInfo] = useState(null)
  const [feeTxHash, setFeeTxHash] = useState(null)
  const [cidFelt, setCidFelt] = useState(null)

  // Calculate fee when file changes
  useEffect(() => {
    if (file) {
      const fee = calculateUploadFee(file.size)
      setFeeInfo(fee)
    } else {
      setFeeInfo(null)
    }
  }, [file])

  const handleUpload = async () => {
    if (!file || !price) return
    
    // Auto-reset if stuck in a previous state
    if (step > 0) {
      setResult(null)
      setError(null)
    }
    
    // If STRK20 is available, pay fee first
    if (isStrk20 && account) {
      setStep(1) // Show fee payment step
      return
    }
    
    // Otherwise proceed directly to upload
    await doUpload()
  }

  const handlePayFee = async () => {
    if (!account || !feeInfo) return
    setStep(2) // Show loading
    
    try {
      // Platform wallet address from env
      const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET
      
      if (isStrk20 && account) {
        // Private transfer via STRK20 pool
        const amountHex = feeInfo.feeHex
        const result = await privateTransfer(
          account,
          STRK_TOKEN_ADDRESS,
          amountHex,
          platformWallet
        )
        
        if (result.pending) {
          // Wallet timeout — tx was likely submitted on-chain
          // Proceed with upload anyway, user can verify on explorer
          console.log('STRK20 tx pending (wallet timeout) — proceeding with upload')
        } else if (!result.success) {
          throw new Error(result.error || 'Payment failed')
        } else {
          console.log('Private fee payment sent:', result.transactionHash)
        }
      } else {
        // Fallback: simulate payment for non-STRK20 wallets
        await new Promise(r => setTimeout(r, 2000))
      }
      
      // Re-connect to get fresh account after STRK20 operation
      if (refreshWallet) {
        const freshAccount = await refreshWallet()
        if (freshAccount) account = freshAccount
      }
      
      // After payment confirmed, proceed to upload
      await doUpload()
    } catch (err) {
      setError(err.message)
      setStep(1) // Back to fee step
    }
  }

  const doUpload = async () => {
    console.log('[doUpload] Starting upload, file:', file?.name, 'price:', price, 'step:', step)
    setStep(2) // Show loading
    setError(null)

    try {
      const buffer = await file.arrayBuffer()
      console.log('[doUpload] File buffer size:', buffer.byteLength)
      const keypair = generateKeyPair()
      const { encrypted, secretKey } = await encryptData(buffer, {
        name: file.name,
        type: file.type,
      }, keypair)
      console.log('[doUpload] Encryption complete, calling API...')

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedData: encrypted,
          fileName: file.name,
          fileType: file.type,
          sellerAddress: account?.address || '',
          price: price || '0',
        }),
      })

      const data = await res.json()
      console.log('[doUpload] API response:', data)
      if (!data.success) throw new Error(data.error)

      // Create FileVault vault
      setStep(3) // Vault creation step
      const cid = data.cid
      console.log('[doUpload] step 3a: cid =', cid)
      const cidFelt = await cidToFelt(cid)
      console.log('[doUpload] step 3b: cidFelt =', cidFelt)
      
      // Generate claim secret (128-bit random)
      const claimSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      console.log('[doUpload] step 3c: claimSecret generated')
      
      // Wrap key seed
      console.log('[doUpload] step 3d: secretKey type =', typeof secretKey, 'length =', secretKey?.length)
      const keySeedCiphertext = await wrapKeySeed(secretKey, claimSecret)
      console.log('[doUpload] step 3e: keySeedCiphertext length =', keySeedCiphertext?.length)
      
      // Compute commitment (must match contract: pedersen(pedersen(cid, high), low))
      // SECURITY NOTE: The on-chain claim secret is a u16 (16 bits) — only 65K possible values.
      // This is acceptable because:
      // 1. The u16 is just a gate for the on-chain state transition (active → claimed)
      // 2. The real encryption key is derived from the FULL 128-bit secret via PBKDF2
      // 3. Even if an attacker brute-forces the u16, they still cannot unwrap the key seed
      const claimSecretNum = parseInt(claimSecret.slice(0, 4), 16) // 16-bit value
      const high = (claimSecretNum >> 8) & 0xFF
      const low = claimSecretNum & 0xFF
      const inner = computePedersenHash(cidFelt, '0x' + high.toString(16).padStart(2, '0'))
      const commitment = computePedersenHash(inner, '0x' + low.toString(16).padStart(2, '0'))
      console.log('[doUpload] step 3f: commitment computed =', commitment)
      
      // Create vault on-chain
      // Store truncated hash of keySeedCiphertext on-chain (felt252 max = 31 bytes), full data on S3
      const keySeedBytes = new TextEncoder().encode(keySeedCiphertext)
      const keySeedHash = await crypto.subtle.digest('SHA-256', keySeedBytes)
      const keySeedHashHex = '0x' + Array.from(new Uint8Array(keySeedHash)).slice(0, 31).map(b => b.toString(16).padStart(2, '0')).join('')
      console.log('[doUpload] step 3g: keySeedCiphertext hash (31 bytes) =', keySeedHashHex)
      
      const priceWei = BigInt(Math.floor(parseFloat(price) * 1e18))
      console.log('[doUpload] step 3h: calling createVault')
      const vaultResult = await createVault(account, {
        cid: cidFelt,
        price: priceWei,
        keySeedCiphertext: keySeedHashHex, // SHA-256 hash on-chain
        commitment,
        ttl: 2592000, // 30 days
      })
      console.log('[doUpload] step 3i: createVault tx submitted', vaultResult?.transaction_hash)
      
      // Upload full keySeedCiphertext to S3 as separate object
      const keySeedS3Key = cid + '.key'
      console.log('[doUpload] step 3j: uploading key seed to S3:', keySeedS3Key)
      await fetch('/api/upload-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keySeedS3Key, data: keySeedCiphertext }),
      })
      console.log('[doUpload] step 3k: key seed uploaded to S3')
      
      // Wait for transaction confirmation
      if (vaultResult?.transaction_hash) {
        console.log('[doUpload] step 3l: waiting for tx confirmation...')
        try {
          await account.provider.waitForTransaction(vaultResult.transaction_hash, { timeout: 60000 })
          console.log('[doUpload] step 3m: tx confirmed!')
        } catch (waitErr) {
          console.warn('[doUpload] waitForTransaction failed:', waitErr.message)
          const verifyVault = await getVault(account, cidFelt)
          if (!verifyVault) {
            throw new Error('Transaction may have failed on-chain. Please try again.')
          }
          console.log('[doUpload] step 3m: vault verified on-chain despite wait timeout')
        }
      }

      setCidFelt(cidFelt)
      setResult({ ...data, claimSecret })
      setStep(4)
    } catch (err) {
      console.error('[doUpload] Error:', err.message, err.stack?.split('\n').slice(0,5).join(' | '))
      setError(err.message)
      setStep(0)
    }
  }

  const reset = () => {
    setFile(null)
    setPrice('')
    setStep(0)
    setResult(null)
    setError(null)
    setFeeInfo(null)
    setCidFelt(null)
  }

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  function getFileIcon(mimeType) {
    if (!mimeType) return '📄'
    if (mimeType.startsWith('image/')) return '🖼️'
    if (mimeType.startsWith('video/')) return '🎬'
    if (mimeType.startsWith('audio/')) return '🎵'
    if (mimeType === 'application/pdf') return '📕'
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
    if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('xml')) return '📝'
    return '📄'
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <>
      {step === 0 && (
        <>
          <div>
            <h3 className="dv-title">Upload Your File</h3>
            <p className="dv-hint">Encrypted and uploaded to Fil One (Filecoin). Any file type works.</p>
          </div>
          
          <div
            className="dv-upload"
            onClick={() => document.getElementById('file-input').click()}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsDragging(false)
              const dropped = e.dataTransfer.files[0]
              if (dropped) setFile(dropped)
            }}
            style={isDragging ? { borderColor: 'rgba(220, 184, 255, 0.8)', background: 'rgba(220, 184, 255, 0.05)' } : {}}
          >
            <input
              id="file-input"
              type="file"
              onChange={(e) => setFile(e.target.files[0])}
              style={{display: 'none'}}
            />
            {file ? (
              <div className="dv-file-info">
                <span className="dv-file-icon">{getFileIcon(file.type)}</span>
                <div>
                  <div className="dv-file-name">{file.name}</div>
                  <div className="dv-file-meta">{formatSize(file.size)} · {file.type || 'unknown'}</div>
                </div>
              </div>
            ) : (
              <p className="dv-hint">Drag a file or click to upload</p>
            )}
          </div>

          {/* Fee Display */}
          {feeInfo && (
            <div style={{
              padding: '16px',
              background: 'rgba(220, 184, 255, 0.1)',
              border: '1px solid rgba(220, 184, 255, 0.3)'
            }}>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--primary)',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Upload Fee
              </div>
              <div style={{
                fontSize: '24px',
                fontWeight: 700,
                color: 'white',
                marginBottom: '8px'
              }}>
                {feeInfo.feeFormatted} STRK
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'rgba(255,255,255,0.5)'
              }}>
                Base: {feeInfo.baseFee} STRK + Storage: {feeInfo.storageFeeFormatted} STRK
              </div>
            </div>
          )}

          <div className="dv-input-group">
            <label>Your Selling Price (STRK)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
            />
            <small>This is what buyers will pay you</small>
          </div>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handleUpload}
            disabled={!file || !price || !connected}
          >
            {!connected ? 'Connect Wallet First' : 
             isStrk20 ? `Pay ${feeInfo?.feeFormatted || '0.5'} STRK & Upload` : 
             'Encrypt & Upload'}
          </button>
        </>
      )}

      {step === 1 && (
        <>
          <div>
            <h3 className="dv-title">Confirm Payment</h3>
            <p className="dv-hint">Pay the upload fee to proceed with file storage.</p>
          </div>

          {feeInfo && (
            <div style={{
              padding: '20px',
              background: 'rgba(220, 184, 255, 0.1)',
              border: '1px solid rgba(220, 184, 255, 0.3)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '12px'
              }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>File size:</span>
                <strong>{feeInfo.sizeFormatted}</strong>
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '12px'
              }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Base fee:</span>
                <strong>{feeInfo.baseFee} STRK</strong>
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '16px'
              }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Storage fee:</span>
                <strong>{feeInfo.storageFeeFormatted} STRK</strong>
              </div>
              <div style={{
                borderTop: '1px solid rgba(255,255,255,0.2)',
                paddingTop: '12px',
                display: 'flex',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontWeight: 700 }}>Total Fee:</span>
                <strong style={{ fontSize: '20px', color: 'var(--primary)' }}>
                  {feeInfo.feeFormatted} STRK
                </strong>
              </div>
            </div>
          )}

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handlePayFee}
          >
            Pay {feeInfo?.feeFormatted || '0.5'} STRK & Upload
          </button>

          <button
            className="dv-btn-secondary"
            onClick={() => setStep(0)}
          >
            Cancel
          </button>
        </>
      )}

      {step === 2 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Encrypting and uploading to Fil One...</p>
        </div>
      )}

      {step === 3 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Creating vault on-chain...</p>
        </div>
      )}

      {step === 4 && result && (
        <>
          <div>
            <h3 className="dv-title">File Uploaded & Vault Created</h3>
            <p className="dv-hint">Share this CID and claim secret privately with your buyer.</p>
          </div>
          
          <div className="dv-cid-box">
            <div className="dv-cid-header">
              <label>CID (share privately)</label>
              <button className="dv-copy" onClick={() => copyToClipboard(result.cid, 'cid')}>
                {copied === 'cid' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <code>{result.cid}</code>
            <small style={{color: 'rgba(255,255,255,0.3)', fontSize: '10px', display: 'block', marginTop: '4px'}}>
              Felt: {cidFelt}
            </small>
          </div>

          <div className="dv-cid-box">
            <div className="dv-cid-header">
              <label>Claim Secret (share privately — needed to decrypt)</label>
              <button className="dv-copy" onClick={() => copyToClipboard(result.claimSecret, 'secret')}>
                {copied === 'secret' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <code className="dv-key">{result.claimSecret}</code>
            <small style={{color: 'rgba(255,255,255,0.4)', marginTop: '8px', display: 'block'}}>
              The raw secret key is stored encrypted in the vault. Only the claim secret can recover it.
            </small>
          </div>

          <div className="dv-info-row">
            <span>File:</span>
            <strong>{result.fileName}</strong>
          </div>
          <div className="dv-info-row">
            <span>Size:</span>
            <strong>{result.fileSize ? (result.fileSize / 1024).toFixed(1) + ' KB' : 'N/A'}</strong>
          </div>
          <div className="dv-info-row">
            <span>Price:</span>
            <strong>{price} STRK</strong>
          </div>

          <button className="dv-btn-secondary" onClick={reset}>Upload Another</button>
        </>
      )}
    </>
  )
}

function BuyFlow({ connected, isStrk20, account, refreshWallet }) {
  const [cid, setCid] = useState('')
  const [step, setStep] = useState(0)
  const [secretKey, setSecretKey] = useState('')
  const [claimSecret, setClaimSecret] = useState('')
  const [objectKey, setObjectKey] = useState('')
  const [encryptedData, setEncryptedData] = useState(null)
  const [decryptedFile, setDecryptedFile] = useState(null)
  const [copied, setCopied] = useState(null)
  const [error, setError] = useState(null)
  const [txHash, setTxHash] = useState(null)
  const [fileMetadata, setFileMetadata] = useState(null)

  const PLATFORM_FEE = '0xde0b6b3a7640000' // 1 STRK in hex (1e18)

  const handlePurchase = async () => {
    if (!cid) return
    setStep(1)
    setError(null)

    try {
      // Fetch vault data from on-chain (price authority)
      const cidFelt = await cidToFelt(cid.trim())
      console.log('[BuyFlow] Searching for CID:', cid.trim(), '-> cidFelt:', cidFelt)
      const vault = await getVault(account, cidFelt) // pass account as provider
      
      if (!vault) {
        throw new Error('No vault found for this CID. The file may not have been uploaded with FileVault.')
      }

      if (Number(vault.status) !== 0) {
        throw new Error('This vault is no longer available (already claimed or refunded)')
      }

      const sellerAddress = vault.seller
      const price = vault.price
      const priceStr = (Number(price) / 1e18).toString()

      setFileMetadata({ sellerAddress, price: priceStr })
      setObjectKey(cid)
      setStep(2)
    } catch (err) {
      setError(err.message)
      setStep(0)
    }
  }

  const handleStrk20Payment = async () => {
    if (!account || !isStrk20 || !fileMetadata) return
    console.log('[handleStrk20Payment] Starting payment...')
    setStep(3)
    setError(null)

    try {
      console.log('Payment metadata:', fileMetadata)
      console.log('Account address:', account?.address)
      console.log('Platform wallet:', process.env.NEXT_PUBLIC_PLATFORM_WALLET)
      
      const sellerAddress = fileMetadata.sellerAddress
      // Ensure sellerAddress is a 0x hex string (wallet API requires it)
      let sellerHex
      if (typeof sellerAddress === 'bigint') {
        sellerHex = '0x' + sellerAddress.toString(16).padStart(64, '0')
      } else if (typeof sellerAddress === 'string' && !sellerAddress.startsWith('0x')) {
        sellerHex = '0x' + BigInt(sellerAddress).toString(16).padStart(64, '0')
      } else {
        sellerHex = sellerAddress
      }
      const priceHex = '0x' + (BigInt(Math.round(parseFloat(fileMetadata.price) * 1e18))).toString(16)
      const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET

      // Single batch transfer: seller payment + platform fee in ONE ZK proof
      // This is much faster - one wallet confirmation instead of two
      const transfers = [
        { amount: priceHex, recipient: sellerHex }
      ]
      if (platformWallet) {
        transfers.push({ amount: PLATFORM_FEE, recipient: platformWallet })
      }

      const result = await batchPrivateTransfer(
        account,
        STRK_TOKEN_ADDRESS,
        transfers
      )

      console.log('[handleStrk20Payment] Result:', result)

      if (result.pending) {
        // Wallet timeout — tx was likely submitted on-chain
        // Proceed with claim flow anyway
        console.log('STRK20 tx pending (wallet timeout) — proceeding')
        if (refreshWallet) {
          await refreshWallet()
        }
        setTxHash(null)
        setStep(4) // Claim step
      } else if (result.success) {
        // Re-connect to get fresh account after STRK20 operation
        if (refreshWallet) {
          await refreshWallet()
        }
        setTxHash(result.transactionHash)
        setStep(4) // Claim step
      } else {
        throw new Error(result.error || 'Payment failed')
      }
    } catch (err) {
      setError(err.message)
      setStep(2)
    }
  }

  const handleDownload = async () => {
    if (!objectKey || !secretKey) return
    setStep(5)
    setError(null)

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectKey }),
      })

      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      setEncryptedData(data.encryptedData)
      setStep(6)
    } catch (err) {
      setError(err.message)
      setStep(2)
    }
  }

  const handleClaim = async () => {
    if (!objectKey || !claimSecret) return
    setStep(5) // Loading
    setError(null)

    try {
      const cidFelt = await cidToFelt(objectKey)
      
      // Claim vault on-chain (contract expects u16 = first 4 hex chars)
      const claimSecretU16 = parseInt(claimSecret.trim().slice(0, 4), 16)
      console.log('[handleClaim] claimSecret U16:', claimSecretU16, 'hex:', claimSecret.trim().slice(0, 4))
      await claimVault(account, cidFelt, claimSecretU16)
      
      // Get vault to retrieve on-chain hash for verification
      const vault = await getVault(account, cidFelt)
      if (!vault) {
        throw new Error('Failed to retrieve vault')
      }

      // Download full keySeedCiphertext from S3
      const keySeedS3Key = objectKey + '.key'
      console.log('[handleClaim] Downloading key seed from S3:', keySeedS3Key)
      const keyRes = await fetch('/api/download-key?key=' + encodeURIComponent(keySeedS3Key))
      if (!keyRes.ok) throw new Error('Failed to download key seed from S3')
      const keyData = await keyRes.json()
      if (!keyData.success) throw new Error(keyData.error)
      const keySeedCiphertext = keyData.data
      console.log('[handleClaim] Key seed downloaded, length:', keySeedCiphertext.length)
      
      // Verify hash matches on-chain (truncate to 31 bytes to match felt252)
      const keySeedBytes = new TextEncoder().encode(keySeedCiphertext)
      const keySeedHash = await crypto.subtle.digest('SHA-256', keySeedBytes)
      const keySeedHashHex = '0x' + Array.from(new Uint8Array(keySeedHash)).slice(0, 31).map(b => b.toString(16).padStart(2, '0')).join('')
      // On-chain value may be decimal string — convert to hex for comparison
      const onChainVal = String(vault.keySeedCiphertext)
      const onChainHash = onChainVal.startsWith('0x') ? onChainVal : '0x' + BigInt(onChainVal).toString(16).padStart(62, '0')
      console.log('[handleClaim] Computed hash:', keySeedHashHex)
      console.log('[handleClaim] On-chain hash:', onChainHash)
      if (keySeedHashHex.toLowerCase() !== onChainHash.toLowerCase()) {
        throw new Error('Key seed hash mismatch — data may be tampered')
      }
      console.log('[handleClaim] Hash verified ✓')

      // Unwrap key seed (uses full 32-char claim secret)
      const secretKey = await unwrapKeySeed(keySeedCiphertext, claimSecret.trim())
      setSecretKey(secretKey)
      
      // Download encrypted file from S3
      console.log('[handleClaim] Downloading encrypted file from S3:', objectKey)
      const downloadRes = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectKey }),
      })
      const downloadData = await downloadRes.json()
      if (!downloadData.success) throw new Error(downloadData.error)
      
      setEncryptedData(downloadData.encryptedData)
      setStep(6) // Show decrypt button
    } catch (err) {
      setError(err.message)
      setStep(4) // Back to claim step
    }
  }

  const handleDecrypt = async () => {
    if (!encryptedData || !secretKey) return
    setStep(7)
    setError(null)

    try {
      const keyBytes = hexToArray(secretKey)
      const { data: decrypted, fileName, fileType } = await decryptData(encryptedData, keyBytes)

      const blob = new Blob([decrypted], { type: fileType })
      const url = URL.createObjectURL(blob)
      setDecryptedFile({ url, name: fileName })
      setStep(8)
    } catch (err) {
      setError('Decryption error: ' + err.message)
      setStep(6)
    }
  }

  const reset = () => {
    setCid('')
    setStep(0)
    setSecretKey('')
    setObjectKey('')
    setEncryptedData(null)
    setDecryptedFile(null)
    setError(null)
    setTxHash(null)
  }

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  function hexToArray(hex) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
    }
    return bytes
  }

  return (
    <>
      {step === 0 && (
        <>
          <div>
            <h3 className="dv-title">Enter CID</h3>
            <p className="dv-hint">Get the CID from the seller. Pay with STRK to receive the decryption key.</p>
          </div>

          <div className="dv-input-group">
            <label>Content Identifier (CID)</label>
            <input
              type="text"
              value={cid}
              onChange={(e) => setCid(e.target.value)}
              placeholder="ownerz/..."
            />
          </div>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handlePurchase}
            disabled={!cid || !connected}
          >
            {!connected ? 'Connect Wallet First' : 'Purchase Access'}
          </button>
        </>
      )}

      {step === 1 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Fetching vault data...</p>
        </div>
      )}

      {step === 2 && (
        <>
          <div>
            <h3 className="dv-title">File Found</h3>
            <p className="dv-hint">
              Review the details and pay to access the encrypted file.
            </p>
          </div>

          {fileMetadata && (
            <div style={{
              background: 'rgba(139,92,246,0.08)',
              border: '1px solid rgba(139,92,246,0.2)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                <span style={{color:'rgba(255,255,255,0.5)',fontSize:'13px'}}>File</span>
                <span style={{color:'#fff',fontSize:'13px'}}>{cid ? cid.slice(0, 20) + '...' : ''}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                <span style={{color:'rgba(255,255,255,0.5)',fontSize:'13px'}}>Price</span>
                <span style={{color:'#8b5cf6',fontWeight:'600',fontSize:'14px'}}>{fileMetadata.price} STRK</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                <span style={{color:'rgba(255,255,255,0.5)',fontSize:'13px'}}>Platform fee</span>
                <span style={{color:'#06b6d4',fontSize:'13px'}}>1 STRK</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between'}}>
                <span style={{color:'rgba(255,255,255,0.5)',fontSize:'13px'}}>Total to pay</span>
                <span style={{color:'#10b981',fontWeight:'600',fontSize:'14px'}}>
                  {parseFloat(fileMetadata.price || 0) + 1} STRK + gas
                </span>
              </div>
            </div>
          )}

          <p className="dv-hint" style={{fontSize:'12px',marginBottom:'12px'}}>
            You need at least {parseFloat(fileMetadata?.price || 0) + 6 + 1} STRK in your public balance 
            (to shield and pay). Then pay privately from the pool.
          </p>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handleStrk20Payment}
          >
            Pay {parseFloat(fileMetadata?.price || 0) + 1} STRK Privately
          </button>
        </>
      )}

      {step === 3 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Generating ZK proof and sending private payment...</p>
          <small style={{color: 'rgba(255,255,255,0.4)', marginTop: '8px'}}>
            This may take a moment. Please approve in your wallet.
          </small>
        </div>
      )}

      {step === 4 && (
        <>
          <div>
            <h3 className="dv-title">Payment Sent</h3>
            <p className="dv-hint">Enter the claim secret from the seller to recover the decryption key.</p>
          </div>

          {txHash && (
            <div className="dv-cid-box">
              <div className="dv-cid-header">
                <label>Transaction Hash</label>
                <button className="dv-copy" onClick={() => copyToClipboard(txHash, 'tx')}>
                  {copied === 'tx' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <code>{formatTxHash(txHash)}</code>
              <a 
                href={getExplorerUrl(txHash)} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{color: 'var(--primary)', fontSize: '12px', marginTop: '8px', display: 'block'}}
              >
                View on Explorer →
              </a>
            </div>
          )}

          {!txHash && account?.address && (
            <div style={{
              background: 'rgba(251,191,36,0.1)',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '13px',
              color: '#fbbf24'
            }}>
              Payment submitted via wallet. Your STRK20 transaction should appear here:
              <a 
                href={`https://sepolia.voyager.online/contract/${account.address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{color: '#8b5cf6', marginLeft: '4px', textDecoration: 'underline'}}
              >
                View on Voyager →
              </a>
              <div style={{fontSize: '11px', color: 'rgba(251,191,36,0.6)', marginTop: '6px'}}>
                Note: STRK20 privacy transactions show as pool interactions — amounts and recipients are hidden by design.
              </div>
            </div>
          )}

          <div className="dv-input-group">
            <label>Claim Secret (from seller)</label>
            <input
              type="text"
              value={claimSecret}
              onChange={(e) => setClaimSecret(e.target.value)}
              placeholder="Enter the claim secret..."
              style={{fontFamily: 'var(--font-mono)', fontSize: '12px'}}
            />
            <small>The seller shared this secret privately with you</small>
          </div>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handleClaim}
            disabled={!claimSecret}
          >
            Claim Key & Download
          </button>
        </>
      )}

      {step === 5 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Downloading from Fil One...</p>
        </div>
      )}

      {step === 6 && encryptedData && (
        <>
          <div>
            <h3 className="dv-title">File Downloaded</h3>
            <p className="dv-hint">Encrypted file downloaded. Now decrypt with your secret key.</p>
          </div>

          <div className="dv-info-row">
            <span>Original file:</span>
            <strong>{encryptedData.fileName || 'unknown'}</strong>
          </div>
          <div className="dv-info-row">
            <span>Type:</span>
            <strong>{encryptedData.fileType || 'unknown'}</strong>
          </div>
          <div className="dv-info-row">
            <span>Encrypted size:</span>
            <strong>{encryptedData.data ? Math.round(encryptedData.data.length / 2) : 0} bytes</strong>
          </div>

          {error && <div className="dv-error">{error}</div>}

          <button className="dv-btn-primary" onClick={handleDecrypt}>
            Decrypt
          </button>
        </>
      )}

      {step === 7 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Decrypting in browser...</p>
        </div>
      )}

      {step === 8 && decryptedFile && (
        <>
          <div>
            <h3 className="dv-title">File Ready</h3>
            <p className="dv-hint">File decrypted in your browser. Download it now.</p>
          </div>

          <a
            href={decryptedFile.url}
            download={decryptedFile.name}
            className="dv-btn-download"
          >
            Download {decryptedFile.name}
          </a>

          <div className="dv-steps">
            <div className="dv-step">
              <span className="dv-step-num">✓</span>
              <span>File downloaded from Fil One (encrypted)</span>
            </div>
            <div className="dv-step">
              <span className="dv-step-num">✓</span>
              <span>Decrypted with ML-KEM768 + AES-256-GCM</span>
            </div>
            <div className="dv-step">
              <span className="dv-step-num">✓</span>
              <span>Never passed through any server unencrypted</span>
            </div>
          </div>

          <button className="dv-btn-secondary" onClick={reset}>Purchase Another</button>
        </>
      )}
    </>
  )
}
