import { useState, useEffect } from 'react'
import { getAvailableWallets, connectWallet, RpcProvider } from '../lib/starknet'
import { getShieldedBalance, STRK_TOKEN_ADDRESS } from '../lib/strk20-payments'
import SellFlow from '../components/SellFlow'
import BuyFlow from '../components/BuyFlow'
import DeploySection from '../components/DeploySection'
import ShieldModal from '../components/ShieldModal'

export default function Ownerz() {
  const [mode, setMode] = useState('sell')
  const [copiedAddress, setCopiedAddress] = useState(false)
  const [showShieldModal, setShowShieldModal] = useState(false)
  const [showHackathonPopup, setShowHackathonPopup] = useState(true)
  const [shieldedBalance, setShieldedBalance] = useState(null)
  const [showShieldedBalance, setShowShieldedBalance] = useState(false)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
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

  const fetchShieldedBalance = async () => {
    if (!walletState.account) return
    setLoadingBalance(true)
    setShowShieldedBalance(true)
    try {
      const result = await getShieldedBalance(walletState.account, STRK_TOKEN_ADDRESS)
      if (result.success) {
        setShieldedBalance(result.message)
      } else {
        setShieldedBalance('Could not fetch balance')
      }
    } catch (err) {
      setShieldedBalance('Error: ' + err.message)
    } finally {
      setLoadingBalance(false)
    }
  }

  return (
    <div className="dv">
      {/* Hackathon Popup */}
      {showHackathonPopup && (
        <div className="dv-popup-overlay" onClick={() => setShowHackathonPopup(false)}>
          <div className="dv-popup-card" onClick={(e) => e.stopPropagation()}>
            <button className="dv-popup-close" onClick={() => setShowHackathonPopup(false)}>✕</button>
            <div className="dv-popup-title">STRK20 Hackathon</div>
            <div className="dv-popup-text">
              Work in progress for the <span style={{color:'var(--accent)'}}>STRK20 Private Sprint</span> hackathon.
            </div>
            <div className="dv-popup-subtitle">
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
          {/* Desktop wallet controls */}
          {walletState.connected ? (
            <div className="dv-nav-desktop">
              <span className={`dv-badge ${walletState.isStrk20 ? 'dv-badge-ok' : 'dv-badge-err'}`}>
                {walletState.isStrk20 ? 'STRK20 Ready' : 'No STRK20'}
              </span>
              <button
                onClick={() => { navigator.clipboard.writeText(walletState.address); setCopiedAddress(true); setTimeout(() => setCopiedAddress(false), 2000) }}
                className="dv-nav-address"
                style={{ padding: '8px 16px', border: '1px solid var(--hairline)', background: copiedAddress ? 'rgba(197, 52, 0, 0.2)' : 'transparent', color: 'var(--accent)', cursor: 'pointer', transition: 'all 0.2s' }}
              >
                {copiedAddress ? '✓ Copied' : `${walletState.address.slice(0,6)}...${walletState.address.slice(-4)}`}
              </button>
              <button onClick={() => setShowShieldModal(true)} className="dv-nav-btn dv-nav-btn-purple">Shield</button>
              {walletState.isStrk20 && (
                <button onClick={fetchShieldedBalance} className="dv-nav-btn dv-nav-btn-cyan">{loadingBalance ? '...' : 'Shielded Funds'}</button>
              )}
              <button onClick={handleDisconnect} className="dv-nav-btn dv-nav-btn-err">Disconnect</button>
            </div>
          ) : (
            <button onClick={handleConnect} disabled={walletState.loading} className="dv-btn-primary dv-nav-connect" style={{ width: 'auto' }}>
              {walletState.loading ? 'Connecting...' : 'CONNECT ↓'}
            </button>
          )}
          {/* Mobile hamburger */}
          <button className="dv-hamburger" onClick={() => setMenuOpen(!menuOpen)}>
            <span></span><span></span><span></span>
          </button>
        </div>
      </nav>

      {/* Mobile Top Bar */}
      {menuOpen && (
        <div className="dv-topbar" onClick={() => setMenuOpen(false)}>
          <div className="dv-topbar-inner" onClick={e => e.stopPropagation()}>
            {walletState.connected ? (
              <>
                <div className="dv-topbar-row">
                  <span className={`dv-badge ${walletState.isStrk20 ? 'dv-badge-ok' : 'dv-badge-err'}`}>
                    {walletState.isStrk20 ? 'STRK20 Ready' : 'No STRK20'}
                  </span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(walletState.address); setCopiedAddress(true); setTimeout(() => setCopiedAddress(false), 2000); setMenuOpen(false) }}
                    className="dv-nav-address"
                    style={{ color: 'var(--accent)', fontSize: '11px', background: copiedAddress ? 'rgba(197, 52, 0, 0.15)' : 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: '2px', border: '1px solid var(--hairline)' }}
                  >
                    {copiedAddress ? '✓ Copied' : `${walletState.address.slice(0,10)}...${walletState.address.slice(-6)}`}
                  </button>
                </div>
                <div className="dv-topbar-row">
                  <button onClick={() => { setShowShieldModal(true); setMenuOpen(false) }} className="dv-topbar-btn dv-topbar-btn-purple">Shield</button>
                  {walletState.isStrk20 && (
                    <button onClick={() => { fetchShieldedBalance(); setMenuOpen(false) }} className="dv-topbar-btn dv-topbar-btn-cyan">{loadingBalance ? '...' : 'Shielded Funds'}</button>
                  )}
                  <button onClick={() => { handleDisconnect(); setMenuOpen(false) }} className="dv-topbar-btn dv-topbar-btn-err">Disconnect</button>
                </div>
              </>
            ) : (
              <button onClick={() => { handleConnect(); setMenuOpen(false) }} disabled={walletState.loading} className="dv-topbar-btn dv-topbar-btn-purple" style={{ width: '100%' }}>
                {walletState.loading ? 'Connecting...' : 'CONNECT ↓'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Shielded Balance Panel */}
      {showShieldedBalance && walletState.connected && (
        <div style={{
          position: 'fixed',
          top: '72px',
          right: '20px',
          zIndex: 50,
          background: 'var(--surface-container-high)',
          border: '1px solid var(--hairline)',
          borderRadius: '0',
          padding: '16px 20px',
          minWidth: '280px',
          maxWidth: '340px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          fontFamily: 'var(--font-body)',
          color: 'var(--on-surface)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.22em', color: 'var(--accent)' }}>
              Shielded Balance
            </span>
            <button
              onClick={() => setShowShieldedBalance(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px', padding: '0' }}
            >
              ✕
            </button>
          </div>
          {loadingBalance ? (
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Loading...</div>
          ) : (
            <div style={{ fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
              {shieldedBalance || 'No balance data'}
            </div>
          )}
          <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
            Funds shielded via STRK20 privacy pool
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="dv-main">
        {/* Hero Section */}
        <section className="dv-hero">
          <div className="dv-hero-image">
            <img src="/images/brand-asset-orange.png" alt="Ownerz Brand Asset" />
            <div className="dv-hero-tagline">SELL FILES. POST-QUANTUM DELIVERY.</div>
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
                    onConnect={handleConnect}
                  />
                ) : (
                  <BuyFlow 
                    connected={walletState.connected}
                    isStrk20={walletState.isStrk20}
                    account={walletState.account}
                    refreshWallet={refreshWallet}
                    onConnect={handleConnect}
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
