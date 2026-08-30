import { useState, useEffect } from 'react'
import { getAvailableWallets, waitForWallets, onWalletInjected, connectWallet, RpcProvider } from '../lib/starknet'
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
    wallet: null,
    isStrk20: false,
    loading: false,
    error: null
  })

  // Check for wallet on mount (mobile-friendly with retry)
  useEffect(() => {
    let cleanup = () => {}
    
    const checkWallet = async () => {
      // First try immediate detection
      let wallets = await getAvailableWallets()
      
      // If no wallets, wait with retry (mobile wallets inject later) — debug only
      if (wallets.length === 0) {
        // silent wait — wallets inject a bit after load on mobile
        wallets = await waitForWallets(5, 500)
      }
      
      if (wallets.length === 0) {
        // Set up listener for late wallet injection
        cleanup = onWalletInjected((wallet) => {
          console.log('Wallet detected via injection listener')
          setWalletState(prev => ({ ...prev, error: null }))
        })
        
        // Only show error on desktop after retries; on mobile don't auto-error — user will tap CONNECT
        setTimeout(() => {
          const isMobile = typeof window !== 'undefined' && (/Mobi|Android/i.test(navigator.userAgent) || window.matchMedia('(max-width:768px)').matches)
          if (isMobile) return // mobile: keep clean, CONNECT will open Kit modal with QR/WebWallet
          setWalletState(prev => {
            if (prev.connected) return prev
            return { 
              ...prev, 
              error: 'No wallet detected. On mobile, use \u2018Connect via QR\u2019 or Web Wallet.' 
            }
          })
        }, 15000)
      } else {
        setWalletState(prev => ({ ...prev, error: null }))
      }
    }
    
    checkWallet()
    
    return () => cleanup()
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
      const isMobile = typeof window !== 'undefined' && (/Mobi|Android/i.test(navigator.userAgent) || window.matchMedia('(max-width:768px)').matches)
      let wallet = null

      // Try injected first with a quick wait (extension may still be injecting)
      let wallets = await getAvailableWallets()
      if (wallets.length === 0 && !isMobile) {
        // On desktop, give the extension 600ms to inject before falling back to Kit
        wallets = await waitForWallets(2, 300)
      }
      const shouldTryKit = isMobile || wallets.length === 0

      if (shouldTryKit) {
        try {
          const { connectViaKit } = await import('../lib/starknet-kit')
          // On desktop, Kit modal still shows injected wallets + QR, so it's safe fallback
          const kitWallet = await connectViaKit({ modalMode: 'alwaysAsk', modalTheme: 'system' })
          if (kitWallet) {
            console.log('StarknetKit wallet obtained', kitWallet?.name || kitWallet?.id)
            wallet = kitWallet
          } else if (wallets.length > 0) {
            wallet = wallets[0]
          } else {
            // Kit cancelled — retry injected once more (user may have just unlocked extension)
            const retryWallets = await getAvailableWallets()
            if (retryWallets.length > 0) wallet = retryWallets[0]
          }
        } catch (kitErr) {
          console.warn('StarknetKit connect failed, falling back to injected', kitErr)
          if (wallets.length > 0) wallet = wallets[0]
          else {
            const retryWallets = await getAvailableWallets()
            if (retryWallets.length > 0) wallet = retryWallets[0]
          }
        }
      } else {
        wallet = wallets[0]
      }
      
      if (!wallet) {
        throw new Error('No wallet detected. On mobile, use \u2018Connect via QR\u2019 to open Ready/Argent mobile app.')
      }
      
      let result
      try {
        result = await connectWallet(wallet)
      } catch (connErr) {
        const msg = connErr?.message || String(connErr)
        // "not preauthorized" means wallet is locked or not yet approved — retry once with explicit request
        if (/not.*preauthorized|preauthorized|not.*authorized/i.test(msg)) {
          console.warn('Wallet not preauthorized, retrying with explicit requestAccounts', msg)
          try {
            const { walletV6 } = await import('starknet')
            await walletV6.requestAccounts(wallet)
            result = await connectWallet(wallet)
          } catch (retryErr) {
            throw connErr // throw original if retry fails
          }
        } else {
          throw connErr
        }
      }
      
      setWalletState({
        connected: true,
        account: result.account,
        address: result.address,
        wallet: result.wallet,
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

  const handleConnectViaKit = async () => {
    setWalletState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const { connectViaKit } = await import('../lib/starknet-kit')
      const kitWallet = await connectViaKit({ modalMode: 'alwaysAsk', modalTheme: 'system' })
      if (!kitWallet) throw new Error('WalletConnect cancelled or not available. Check NEXT_PUBLIC_WC_PROJECT_ID env.')
      const result = await connectWallet(kitWallet)
      setWalletState({
        connected: true,
        account: result.account,
        address: result.address,
        wallet: result.wallet,
        isStrk20: result.isStrk20,
        loading: false,
        error: null
      })
    } catch (err) {
      setWalletState(prev => ({ ...prev, loading: false, error: err.message }))
    }
  }

  const handleOpenInReadyApp = async () => {
    if (typeof window === 'undefined') return
    // Use StarknetKit's WalletConnect flow which correctly handles ready:// deeplink.
    // Manual https://ready.co/app?url=... is 404 — correct is ready:// + fallback to download.
    try {
      const { connectViaKit } = await import('../lib/starknet-kit')
      const w = await connectViaKit({ modalMode: 'alwaysAsk', modalTheme: 'system' })
      if (w) return // Kit handled QR/deeplink
    } catch {}
    // Fallback: try app scheme then store
    const currentUrl = window.location.href
    window.location.href = `ready://app?url=${encodeURIComponent(currentUrl)}`
    setTimeout(() => window.open('https://ready.co/download', '_blank'), 1200)
  }

  const handleDisconnect = async () => {
    // Clear StarknetKit / WalletConnect persistence so next connect shows popup again
    try {
      const { disconnectKit } = await import('../lib/starknet-kit')
      await disconnectKit({ clearLastWallet: true })
    } catch {}
    // Clear Kit + WC + get-starknet localStorage (cookies don't help)
    if (typeof window !== 'undefined') {
      try {
        const keysToRemove = []
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)
          if (!k) continue
          if (/starknet|walletconnect|wc:|kit|WALLETCONNECT/i.test(k)) keysToRemove.push(k)
        }
        keysToRemove.forEach(k => localStorage.removeItem(k))
        // Also clear sessionStorage
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i)
          if (k && /starknet|walletconnect|wc:/i.test(k)) sessionStorage.removeItem(k)
        }
        // Specific keys StarknetKit uses
        localStorage.removeItem('starknetLastConnectedWallet')
        localStorage.removeItem('starknetkit:connectedWallet')
        localStorage.removeItem('lastConnectedWallet')
      } catch {}
    }
    setWalletState({
      connected: false,
      account: null,
      address: '',
      wallet: null,
      isStrk20: false,
      loading: false,
      error: null
    })
  }

  // Re-connect wallet to get a fresh account (needed after STRK20 operations)
  const refreshWallet = async (preferredWallet) => {
    try {
      // Prefer explicit wallet (e.g. from Kit), then stored, then discovery
      let wallet = preferredWallet || walletState.wallet || null
      if (!wallet) {
        const wallets = await getAvailableWallets()
        if (wallets.length === 0) return null
        wallet = wallets[0]
      }
      const result = await connectWallet(wallet)
      setWalletState(prev => ({
        ...prev,
        account: result.account,
        address: result.address,
        wallet: result.wallet,
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

  const isNoWalletError = walletState.error && /No wallet detected/i.test(walletState.error)

  return (
    <div className="dv">
      {/* Hackathon Popup */}
      {showHackathonPopup && (
        <div className="dv-popup-overlay" onClick={() => setShowHackathonPopup(false)}>
          <div
            className="dv-popup-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-raised)',
              border: '1px solid var(--line)',
              clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
            }}
          >
            <button className="dv-popup-close" onClick={() => setShowHackathonPopup(false)} style={{ color: 'var(--accent)' }}>✕</button>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: '8px' }}>
              A butterfly's flutter can summon a storm — we built the umbrella
            </div>
            <div className="dv-popup-title" style={{ fontFamily: 'var(--mono)', letterSpacing: '0.10em' }}>STRK20 Hackathon</div>
            <div className="dv-popup-text">
              Your files, protected beyond the next generation of computing.
            </div>
            <div className="dv-popup-subtitle" style={{ fontFamily: 'var(--mono)' }}>
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
          <img src="/images/ownerz_logotype.png" alt="OWNERZ" className="dv-logo-img" style={{ height: '104px', width: 'auto' }} />
          {/* Desktop wallet controls */}
          {walletState.connected ? (
            <div className="dv-nav-desktop" style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className={`dv-badge ${walletState.isStrk20 ? 'dv-badge-ok' : 'dv-badge-err'}`}>
                  {walletState.isStrk20 ? 'STRK20 Ready' : 'No STRK20'}
                </span>
                <button
                  onClick={() => { navigator.clipboard.writeText(walletState.address); setCopiedAddress(true); setTimeout(() => setCopiedAddress(false), 2000) }}
                  className="dv-nav-address"
                  style={{ padding: '6px 12px', border: '1px solid var(--line)', background: copiedAddress ? 'rgba(112,145,255,0.12)' : 'transparent', color: 'rgba(153,176,255,.9)', cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'var(--mono)', fontSize: '13px', letterSpacing: '0.10em', textTransform: 'uppercase' }}
                >
                  {copiedAddress ? '✓ Copied' : `${walletState.address.slice(0,6)}...${walletState.address.slice(-4)}`}
                </button>
                <button onClick={handleDisconnect} className="dv-nav-btn dv-nav-btn-err" style={{ fontFamily: 'var(--mono)', fontSize: '13px', padding: '5px 10px' }}>Disconnect</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button onClick={() => setShowShieldModal(true)} className="dv-nav-btn dv-nav-btn-purple" style={{ fontFamily: 'var(--mono)', fontSize: '13px', padding: '5px 10px' }}>Shield</button>
                {walletState.isStrk20 && (
                  <button onClick={fetchShieldedBalance} className="dv-nav-btn dv-nav-btn-cyan" style={{ fontFamily: 'var(--mono)', fontSize: '13px', padding: '5px 10px' }}>{loadingBalance ? '...' : 'Shielded Funds'}</button>
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={handleConnect}
              disabled={walletState.loading}
              className="dv-btn-primary dv-nav-connect"
              style={{
                width: 'auto',
                padding: '10px 20px',
                clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
                transition: 'transform .15s, box-shadow .2s',
              }}
            >
              {walletState.loading ? 'Connecting...' : 'CONNECT WALLET ↗'}
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
                    style={{ color: 'rgba(153,176,255,.9)', fontSize: '13px', background: copiedAddress ? 'rgba(112,145,255,0.12)' : 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: '2px', border: '1px solid var(--hairline)' }}
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
              {walletState.loading ? 'Connecting...' : 'CONNECT WALLET ↗'}
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
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.22em', color: 'var(--accent)' }}>
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
          <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--text-muted)' }}>
            Funds shielded via STRK20 privacy pool
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="dv-main">
        {/* Hero Section */}
        <section className="dv-hero reveal" style={{
          position: 'relative',
          minHeight: '60vh',
          width: '100%',
        }}>
          <div className="dv-hero-content reveal reveal-d1" style={{ position: 'relative', zIndex: 1, maxWidth: '480px' }}>
            <h1 style={{
              fontFamily: 'var(--display)',
              fontSize: 'clamp(36px,4.5vw,60px)',
              fontWeight: 800,
              letterSpacing: '-0.025em',
              textTransform: 'uppercase',
              lineHeight: 0.95,
              background: 'linear-gradient(178deg, #F7F9FF 0%, #DFE7FB 55%, #C9CEDB 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              color: 'transparent',
              margin: 0,
            }}>YOUR FILES.<br/>QUANTUM<br/>OWNERSHIP.</h1>
            <p style={{ fontFamily: 'var(--body)', fontSize: '16px', lineHeight: '1.5', color: 'var(--text-secondary)', margin: 0, maxWidth: '380px' }}>
              Store, encrypt and manage your files on the post-quantum blockchain. Built for a sovereign digital future.
            </p>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '2px' }}>
              <button onClick={handleConnect} disabled={walletState.loading} className="dv-btn-primary" style={{
                width: 'auto',
                padding: '10px 20px',
                clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
                fontSize: '13px',
              }}>
                {walletState.loading ? 'Connecting...' : 'CONNECT WALLET ↗'}
              </button>
            </div>
          </div>
          
          <div className="dv-hero-content reveal reveal-d2" style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifySelf: 'center' }}>
            {/* Error Banner */}
            {walletState.error && (
              <div className="dv-error" style={{ marginBottom: '24px' }}>
                <div>{walletState.error}</div>
                {isNoWalletError && (
                  <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
                    <button onClick={handleConnectViaKit} disabled={walletState.loading} className="dv-btn-primary" style={{ width: 'auto', padding: '8px 16px', fontSize: '13px' }}>
                      {walletState.loading ? 'Connecting...' : 'Connect via QR'}
                    </button>
                    <button onClick={handleOpenInReadyApp} className="dv-nav-btn dv-nav-btn-purple" style={{ padding: '8px 16px', fontSize: '13px', border: '1px solid var(--hairline)' }}>
                      Open in Ready App
                    </button>
                  </div>
                )}
              </div>
            )}
            
            {/* STRK20 Warning */}
            {walletState.connected && !walletState.isStrk20 && (
              <div className="dv-info-box" style={{ marginBottom: '24px' }}>
                <strong>STRK20 not supported.</strong> Install Ready extension for private payments. 
                Current wallet: {walletState.address.slice(0,6)}...{walletState.address.slice(-4)}
              </div>
            )}
            
            <div className="dv-card" style={{
              background: 'rgba(5,8,18,.45)',
              border: '1px solid rgba(91,112,168,.25)',
              clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
              boxShadow: '0 0 40px rgba(112,145,255,.08)',
              position: 'relative',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
            }}>
              {/* Luminous top rule */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: '12px',
                right: '12px',
                height: '1px',
                background: 'linear-gradient(90deg, transparent, rgba(112,145,255,.30), transparent)',
              }} />
              {/* Tabs */}
              <div className="dv-tabs" style={{ borderBottom: '1px solid var(--line)' }}>
                <button 
                  className={`dv-tab ${mode === 'sell' ? 'active' : ''}`}
                  onClick={() => setMode('sell')}
                  style={{
                    fontFamily: 'var(--mono)',
                    position: 'relative',
                  }}
                >
                  <span style={{ color: mode === 'sell' ? 'rgba(153,176,255,.9)' : 'transparent', marginRight: '6px', fontSize: '13px', verticalAlign: 'middle' }}>●</span>UPLOAD DATA
                  {mode === 'sell' && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(153,176,255,.9)' }} />}
                </button>
                <button 
                  className={`dv-tab ${mode === 'buy' ? 'active' : ''}`}
                  onClick={() => setMode('buy')}
                  style={{
                    fontFamily: 'var(--mono)',
                    position: 'relative',
                  }}
                >
                  ACCESS WITH CID
                  {mode === 'buy' && <span style={{ position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '4px', height: '4px', borderRadius: '50%', background: 'rgba(153,176,255,.9)' }} />}
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

        {/* Marketing Placeholders */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '16px clamp(20px, 5vw, 60px)', position: 'relative' }}>
          {/* Gradient divider line */}
          <div style={{ width: '100%', height: '1px', background: 'linear-gradient(90deg, rgba(112,145,255,.40), rgba(153,112,255,.20), transparent)', marginBottom: '8px' }} />
          
          {/* Features Grid */}
          <div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: '12px' }}>
              // WHY OWNERZ
            </div>
            <div className="dv-features-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {[
                { 
                  title: 'POST-QUANTUM SECURITY', 
                  desc: 'Your data, protected beyond the next generation of computing.',
                  icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
                },
                { 
                  title: 'DECENTRALIZED STORAGE', 
                  desc: 'Powered by Filecoin. Accessible anywhere, forever.',
                  icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
                },
                { 
                  title: 'TRUE OWNERSHIP', 
                  desc: 'You control your files. No middlemen. No limits.',
                  icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
                },
                { 
                  title: 'FAST & EFFICIENT', 
                  desc: 'Built for creators, builders and the next wave of the internet.',
                  icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
                },
              ].map((f, i) => (
                <div key={i} style={{
                  background: 'rgba(5,8,18,.35)',
                  border: '1px solid rgba(91,112,168,.18)',
                  padding: '16px 14px',
                  clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                }}>
                  <div style={{ color: 'var(--text-secondary)', opacity: 0.7 }}>{f.icon}</div>
                  <h3 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(15px,1.2vw,18px)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-0.025em', color: 'var(--text-primary)', margin: 0, lineHeight: 1.3 }}>{f.title}</h3>
                  <p style={{ fontFamily: 'var(--body)', fontSize: '14px', lineHeight: '1.5', color: 'var(--text-secondary)', margin: 0, flex: 1 }}>{f.desc}</p>
                  <div style={{ width: '28px', height: '2px', background: 'linear-gradient(90deg, rgba(112,145,255,.40), transparent)', marginTop: '4px' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Metrics Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'clamp(16px, 3vw, 48px)',
            flexWrap: 'wrap',
            borderTop: '1px solid var(--line-subtle)',
            paddingTop: '24px',
            paddingBottom: '12px',
          }}>
            <img src="/images/ownerz_logotype.png" alt="OWNERZ" style={{ height: '96px', width: 'auto', flexShrink: 0 }} />
            <div style={{ display: 'flex', gap: 'clamp(24px, 5vw, 64px)', flexWrap: 'wrap', flex: 1, justifyContent: 'center' }}>
              {[
                { label: 'STORED', value: '+5GB' },
                { label: 'UPTIME', value: '99.9%' },
                { label: 'FILES STORED', value: '+35' },
              ].map((m, i) => (
                <div key={i} style={{ textAlign: 'center', minWidth: '80px' }}>
                  <div style={{ fontFamily: 'var(--display)', fontSize: 'clamp(20px,2.5vw,36px)', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{m.value}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'var(--faint)', marginTop: '6px' }}>{m.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '13px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--faint)', textAlign: 'right', flexShrink: 0, lineHeight: 1.6 }}>
              — THE FUTURE BELONGS<br/>TO OWNERS —
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
