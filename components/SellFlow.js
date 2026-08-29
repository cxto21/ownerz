import { useState, useEffect } from 'react'
import { generateListing, lock, readLock, getFee, identifierToFelt, computeCommitment, computeIntegrityHash, stringToFelt } from '../lib/key-onchain/index.js'
import { uploadEncryptedFile, uploadKeySeed } from '../lib/storage/index.js'
import { calculateUploadFee } from '../lib/fees'
import { getFileIcon, formatSize, copyToClipboard } from './utils'
import { getPqcCapability } from '../lib/pqc'
import { createAccessToken, getSellerTokens, getTokenInfo } from '../lib/access-token.js'

export default function SellFlow({ connected, isStrk20, account, refreshWallet, onConnect }) {
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [price, setPrice] = useState('')
  const [step, setStep] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)
  const [feeInfo, setFeeInfo] = useState(null)
  const [cidFelt, setCidFelt] = useState(null)
  const [showPqcTip, setShowPqcTip] = useState(false)
  const [conn, setConn] = useState({ tls13: null, pqc: 'unknown' })

  // Access Token state
  const [showTokenCreate, setShowTokenCreate] = useState(false)
  const [sellerTokens, setSellerTokens] = useState([])
  const [selectedToken, setSelectedToken] = useState(null) // { address, name, symbol, price, durationLabel }
  const [tokenCreateState, setTokenCreateState] = useState({ name: '', symbol: '', price: '', duration: 30 })
  const [tokenCreateLoading, setTokenCreateLoading] = useState(false)
  const [tokenCreateError, setTokenCreateError] = useState(null)
  const [tokensLoading, setTokensLoading] = useState(false)
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false)

  // Invite link generator state (no file)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [inviteResult, setInviteResult] = useState(null)
  const [inviteCopied, setInviteCopied] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function detect() {
      let tls13 = false
      try {
        const r = await fetch('/api/tls-info', { cache: 'no-store' })
        if (r.ok) tls13 = !!(await r.json()).tls13
      } catch {}
      const pqc = await getPqcCapability()
      if (!cancelled) setConn({ tls13, pqc })
    }
    detect()
    return () => { cancelled = true }
  }, [])

  // Load seller tokens when connected
  useEffect(() => {
    if (connected && account && isStrk20) {
      let cancelled = false
      async function loadTokens() {
        setTokensLoading(true)
        try {
          const addresses = await getSellerTokens(account.address)
          const tokens = []
          for (const addr of addresses) {
            const info = await getTokenInfo(addr)
            if (info) tokens.push(info)
          }
          if (!cancelled) setSellerTokens(tokens)
        } catch (e) {
          console.warn('[SellFlow] Failed to load seller tokens:', e.message)
          if (!cancelled) setSellerTokens([])
        } finally {
          if (!cancelled) setTokensLoading(false)
        }
      }
      loadTokens()
      return () => { cancelled = true }
    } else {
      setSellerTokens([])
    }
  }, [connected, account, isStrk20])

  // Close token dropdown on outside click
  useEffect(() => {
    if (!tokenDropdownOpen) return
    function onDocClick(e) {
      const root = document.getElementById('dv-token-dropdown-root')
      if (root && !root.contains(e.target)) setTokenDropdownOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [tokenDropdownOpen])

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
    if (step > 0) {
      setResult(null)
      setError(null)
    }

    setStep(1)
    setError(null)

    try {
      // Step 1: Generate vault_uid (random, never stored on-chain)
      const vaultUidBytes = crypto.getRandomValues(new Uint8Array(16))
      const vaultUid = '0x' + Array.from(vaultUidBytes).map(b => b.toString(16).padStart(2, '0')).join('')

      // Step 2: Generate claim secret
      const claimSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      // Step 3: Generate listing payload (encrypt + wrap key — single keypair!)
      const listing = await generateListing({
        file,
        fileName: file.name,
        fileType: file.type,
        cid: 'pending',
        claimSecret,
      })

      // Step 4: Upload encrypted file (server generates final CID)
      const uploadResult = await uploadEncryptedFile('pending', listing.encrypted, file.name)
      const cid = uploadResult.cid || uploadResult.key
      if (!cid || cid === 'pending') throw new Error('Upload failed to return CID')

      // Step 5: Compute identifier from vault_uid (NOT from cid) — vault_uid is the access key
      const identifier = await identifierToFelt(vaultUid)
      const commitment = computeCommitment(identifier, claimSecret)
      const integrityHash = listing.integrityHash
      const keySeedCiphertext = listing.keySeedCiphertext

      // Step 6: Lock on-chain with recomputed commitment (include PQC from edge)
      setStep(2)
      const priceWei = BigInt(Math.floor(parseFloat(price) * 1e18))
      const fee = await getFee()
      const pqc = uploadResult.pqc ?? false

      const lockResult = await lock({
        account,
        identifier,
        commitment,
        integrityHash,
        meta: { price: priceWei, ttl: 2592000, fee, pqc, tokenGate: selectedToken?.address || '0x0', fileCid: stringToFelt(cid) },
      })

      // Step 6: Upload key seed (same wrapped key as step 2)
      await uploadKeySeed(cid, keySeedCiphertext)

      // Step 7: Wait for tx confirmation
      if (lockResult?.transaction_hash) {
        try {
          await account.provider.waitForTransaction(lockResult.transaction_hash, { timeout: 60000 })
        } catch (waitErr) {
          console.warn('waitForTransaction failed:', waitErr.message)
          const verifyLock = await readLock(identifier)
          if (!verifyLock) {
            throw new Error('Transaction may have failed on-chain. Please try again.')
          }
        }
      } else if (lockResult?.transaction_hash === null && lockResult?.pending) {
        // STRK20-like timeout or wallet pending — verify via readLock
        await new Promise(r => setTimeout(r, 3000))
        const verifyLock = await readLock(identifier)
        if (!verifyLock) console.warn('Vault not yet visible on-chain, may need a few seconds')
      }

      setCidFelt(identifier)
      setResult({ cid, claimSecret, fileName: file.name, fileSize: file.size, pqc, vaultUid })
      setStep(3)
    } catch (err) {
      console.error('[SellFlow] Error:', err.message)
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

  const handleGenerateInvite = async () => {
    if (!account) {
      setInviteError('Wallet not connected')
      return
    }
    if (!selectedToken?.address) {
      setInviteError('Select a soulbound token first')
      return
    }
    setInviteLoading(true)
    setInviteError(null)
    setInviteResult(null)
    try {
      // Generate vault_uid = 0x + 32 hex chars (16B random)
      const vaultUidBytes = crypto.getRandomValues(new Uint8Array(16))
      const vaultUid = '0x' + Array.from(vaultUidBytes).map(b => b.toString(16).padStart(2, '0')).join('')
      // Generate dummy claimSecret (needed for commitment but not shared for invite)
      const claimSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      const identifier = await identifierToFelt(vaultUid)
      const commitment = computeCommitment(identifier, claimSecret)
      const integrityHash = await computeIntegrityHash('invite-' + vaultUid)
      const fileCid = '0x0'
      const fee = await getFee()
      const tokenGate = selectedToken.address
      const lockResult = await lock({
        account,
        identifier,
        commitment,
        integrityHash,
        meta: { price: 1n, ttl: 2592000, fee, pqc: false, tokenGate, fileCid },
      })
      // Wait for tx confirmation (same pattern as handleUpload)
      if (lockResult?.transaction_hash) {
        try {
          await account.provider.waitForTransaction(lockResult.transaction_hash, { timeout: 60000 })
        } catch (waitErr) {
          console.warn('waitForTransaction failed:', waitErr.message)
          const verifyLock = await readLock(identifier)
          if (!verifyLock) {
            throw new Error('Transaction may have failed on-chain. Please try again.')
          }
        }
      } else if (lockResult?.transaction_hash === null && lockResult?.pending) {
        await new Promise(r => setTimeout(r, 3000))
        const verifyLock = await readLock(identifier)
        if (!verifyLock) console.warn('Vault not yet visible on-chain, may need a few seconds')
      }
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      setInviteResult({
        vaultUid,
        link: `${origin}/v/${vaultUid}`,
        joinLink: `${origin}/join/${vaultUid}`,
        tokenGate,
        tokenName: `${selectedToken.name} (${selectedToken.symbol})`,
      })
    } catch (e) {
      console.error('[SellFlow] Generate invite failed:', e)
      setInviteError(e.message || 'Failed to generate invite link')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleCreateToken = async () => {
    const { name, symbol, price, duration } = tokenCreateState
    if (!name.trim() || !symbol.trim()) {
      setTokenCreateError('Name and symbol are required')
      return
    }
    if (!account) {
      setTokenCreateError('Wallet not connected')
      return
    }
    setTokenCreateLoading(true)
    setTokenCreateError(null)
    try {
      const priceWei = BigInt(Math.floor(parseFloat(price || '0') * 1e18))
      const durationSec = duration * 86400 // days to seconds
      const result = await createAccessToken(account, {
        name: `Ownerz Soulbound (${name.trim()})`,
        symbol: `Oz${symbol.trim()}`,
        price: priceWei,
        duration: durationSec,
      })
      // Wait for tx confirmation so on-chain state is updated before re-reading
      const txHash = result?.result?.transaction_hash || result?.result?.transaction_hash
      if (txHash) {
        try {
          await account.provider.waitForTransaction(txHash, { timeout: 60000 })
        } catch (waitErr) {
          console.warn('[SellFlow] waitForTransaction failed after token create:', waitErr.message)
        }
      }
      console.log('[SellFlow] Token created:', result)
      setTokenCreateState({ name: '', symbol: '', price: '', duration: 30 })
      setShowTokenCreate(false)
      // Reload tokens — now on-chain state is confirmed
      const addresses = await getSellerTokens(account.address)
      const tokens = []
      for (const addr of addresses) {
        const info = await getTokenInfo(addr)
        if (info) tokens.push(info)
      }
      setSellerTokens(tokens)
    } catch (e) {
      console.error('[SellFlow] Create token failed:', e)
      setTokenCreateError(e.message || 'Failed to create token')
    } finally {
      setTokenCreateLoading(false)
    }
  }

  return (
    <>
      <style>{`.dv-pqc-bubble:hover .dv-pqc-tooltip{opacity:1 !important; pointer-events:auto !important;}`}</style>
      {step > 0 && step < 4 && (
        <div className="dv-progress">
          <div className={`dv-progress-step ${step >= 1 ? 'done' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 2 ? 'done' : step === 1 ? 'active' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 3 ? 'done' : step === 2 ? 'active' : ''}`}></div>
          <span className="dv-progress-label">Step {Math.min(step, 3)} of 3</span>
        </div>
      )}

      {step === 0 && (
        <>
          <div style={{display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px 16px', marginBottom:'16px', flexWrap:'wrap'}}>
            <div style={{flex:'1 1 160px', minWidth:0}}>
              <h3 className="dv-title" style={{margin:0, lineHeight:'1.1'}}>Upload Your File</h3>
              <p className="dv-hint" style={{margin:'6px 0 0 0', fontSize:'13px'}}>Encrypted and uploaded to Fil One (Filecoin). Any file type works.</p>
            </div>
            <div className="dv-pqc-bubble dv-badge" onClick={() => setShowPqcTip(!showPqcTip)} style={{position:'relative', display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'10px', padding:'6px 10px', borderRadius:'2px', background: conn.tls13 && conn.pqc === 'supported' ? 'rgba(197,52,0,0.08)' : 'rgba(239,68,68,0.08)', border:'1px solid var(--hairline)', color: conn.tls13 && conn.pqc === 'supported' ? 'var(--accent)' : '#ef4444', cursor:'pointer', flexShrink:0, alignSelf:'flex-start', letterSpacing:'0.14em', fontFamily:'var(--font-mono)', textTransform:'uppercase', backdropFilter:'blur(12px)'}}>
              <span style={{width:'6px', height:'6px', borderRadius:'50%', background: conn.tls13 && conn.pqc === 'supported' ? 'var(--accent)' : '#ef4444', display:'inline-block', boxShadow: conn.tls13 && conn.pqc === 'supported' ? '0 0 8px var(--accent-glow)' : '0 0 8px rgba(239,68,68,0.4)'}}></span>
              {conn.tls13 == null ? 'Checking…' : conn.tls13 && conn.pqc === 'supported' ? 'PQC ready' : conn.tls13 ? 'TLS 1.3 · PQ unknown' : 'Non-PQC'}
              <span style={{width:'14px', height:'14px', borderRadius:'50%', background:'rgba(197,52,0,0.12)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'9px', fontWeight:'600', color:'var(--accent)', border:'1px solid rgba(197,52,0,0.2)'}}>i</span>
              <div className="dv-pqc-tooltip" style={{position:'absolute', top:'calc(100% + 10px)', right:0, width:'300px', maxWidth:'calc(100vw - 32px)', background:'var(--raised)', backdropFilter:'blur(20px)', border:'1px solid var(--hairline)', borderRadius:'2px', padding:'14px 16px', fontSize:'13px', lineHeight:'1.6', color:'var(--text-secondary)', boxShadow:'0 12px 32px rgba(0,0,0,0.5)', opacity: showPqcTip ? 1 : 0, pointerEvents: showPqcTip ? 'auto' : 'none', transition:'all 0.2s', zIndex:10, textAlign:'left', fontFamily:'var(--font-body)', textTransform:'none', letterSpacing:'0'}}>
                {conn.tls13 == null
                  ? 'Detecting your connection security (edge TLS + browser post-quantum capability)…'
                  : conn.tls13 && conn.pqc === 'supported'
                    ? 'Your connection to the edge uses TLS 1.3 and your browser supports post-quantum key exchange (X25519MLKEM768) — this upload is protected against harvest-now-decrypt-later attacks.'
                    : conn.tls13
                      ? 'TLS 1.3 confirmed, but your browser PQ capability could not be verified. Update to Chrome/Edge 124+, Firefox 132+ or Safari 18+ for post-quantum protection.'
                      : 'This connection is not using TLS 1.3. Update your browser to enable PQC (Post-Quantum Cryptography) protection.'}
              </div>
            </div>
          </div>

          <div
            className={`dv-upload ${isDragging ? 'dragging' : ''}`}
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
          >
            <input
              id="file-input"
              type="file"
              onChange={(e) => setFile(e.target.files[0])}
              style={{display: 'none'}}
            />
            {file ? (
              <div className="dv-file-card">
                <div className="dv-file-info">
                  <span className="dv-file-icon">{getFileIcon(file.type)}</span>
                  <div>
                    <div className="dv-file-name">{file.name}</div>
                    <div className="dv-file-meta">{formatSize(file.size)} · {file.type || 'unknown'}</div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="dv-upload-icon">↑</div>
                <p className="dv-hint">Drag a file or click to upload</p>
              </>
            )}
          </div>

          {feeInfo && (
            <div className="dv-fee-display">
              <div className="dv-fee-label">Upload Fee</div>
              <div className="dv-fee-amount">{feeInfo.feeFormatted} STRK</div>
              <div className="dv-fee-breakdown">
                Base: {feeInfo.baseFee} STRK + Storage: {feeInfo.storageFeeFormatted} STRK
              </div>
            </div>
          )}

          {/* Access Token Section — optional gating for this vault */}
          {connected && isStrk20 && (
            <div className="dv-token-section" style={{marginTop:'16px', padding:'16px', background:'var(--raised)', border:'1px solid var(--hairline)', borderRadius:'2px'}}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px', flexWrap:'wrap', gap:'8px'}}>
                <h4 style={{margin:0, fontSize:'12px', fontWeight:700, color:'var(--text-primary)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.22em'}}>Access Token <span style={{color:'var(--text-muted)', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:'11px'}}> — Optional</span></h4>
                {!showTokenCreate && (
                  <button
                    type="button"
                    onClick={() => setShowTokenCreate(true)}
                    className="dv-btn-primary"
                    style={{
                      width:'auto',
                      padding:'6px 12px',
                      fontSize:'11px',
                      letterSpacing:'0.14em',
                    }}
                  >
                    Create Token
                  </button>
                )}
              </div>

              <p className="dv-hint" style={{margin:'0 0 12px 0', fontSize:'12px', color:'var(--text-muted)', lineHeight:'1.5'}}>
                Create a soulbound ERC20 token to gate access to this vault. Buyers must hold ≥1 token to claim.
              </p>

              {/* My Tokens Dropdown — custom brand-aligned */}
              {(tokensLoading || sellerTokens.length > 0) && (
                <div style={{marginBottom: showTokenCreate ? '16px' : '0'}}>
                  <label style={{display:'block', marginBottom:'8px', fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.22em'}}>My Tokens</label>
                  {tokensLoading ? (
                    <div style={{padding:'16px', fontSize:'14px', fontFamily:'var(--font-mono)', color:'var(--text-muted)', background:'var(--input-bg)', border:'1px solid var(--hairline)', borderRadius:'2px'}}>
                      Loading soulbound tokens…
                    </div>
                  ) : (
                  <div id="dv-token-dropdown-root" style={{position:'relative'}}>
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={tokenDropdownOpen}
                      onClick={() => setTokenDropdownOpen(o => !o)}
                      style={{
                        width:'100%',
                        display:'flex',
                        alignItems:'center',
                        justifyContent:'space-between',
                        gap:'12px',
                        padding:'16px',
                        fontSize:'14px',
                        fontFamily:'var(--font-mono)',
                        background:'var(--input-bg)',
                        border:`1px solid ${tokenDropdownOpen ? 'var(--accent)' : 'var(--hairline)'}`,
                        borderRadius:'2px',
                        color: selectedToken ? 'var(--text-primary)' : 'var(--text-muted)',
                        cursor:'pointer',
                        textAlign:'left',
                        transition:'border-color 0.2s, box-shadow 0.2s',
                        boxShadow: tokenDropdownOpen ? '0 0 0 1px rgba(197,52,0,0.15)' : 'none',
                      }}
                    >
                      <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, minWidth:0}}>
                        {selectedToken ? `${selectedToken.name} (${selectedToken.symbol}) — ${selectedToken.priceFormatted} · ${selectedToken.durationLabel}` : '— Select an existing token —'}
                      </span>
                      <span style={{flexShrink:0, color:'var(--text-muted)', transform: tokenDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition:'transform 0.2s', fontSize:'10px', lineHeight:1}}>▼</span>
                    </button>
                    {tokenDropdownOpen && (
                      <div
                        role="listbox"
                        style={{
                          position:'absolute',
                          top:'calc(100% + 6px)',
                          left:0,
                          right:0,
                          background:'var(--raised)',
                          border:'1px solid var(--hairline)',
                          borderRadius:'2px',
                          zIndex:20,
                          overflow:'hidden',
                          boxShadow:'0 12px 32px rgba(0,0,0,0.5)',
                          maxHeight:'220px',
                          overflowY:'auto',
                        }}
                      >
                        <div
                          role="option"
                          aria-selected={!selectedToken}
                          onClick={() => { setSelectedToken(null); setTokenDropdownOpen(false) }}
                          onMouseEnter={(e) => { if (selectedToken) e.currentTarget.style.background = 'rgba(197,52,0,0.1)' }}
                          onMouseLeave={(e) => { if (selectedToken) e.currentTarget.style.background = 'transparent' }}
                          style={{
                            padding:'12px 16px',
                            fontSize:'13px',
                            fontFamily:'var(--font-mono)',
                            color: !selectedToken ? 'var(--accent)' : 'var(--text-secondary)',
                            background: !selectedToken ? 'rgba(197,52,0,0.1)' : 'transparent',
                            borderLeft: !selectedToken ? '2px solid var(--accent)' : '2px solid transparent',
                            cursor:'pointer',
                            display:'flex',
                            justifyContent:'space-between',
                            alignItems:'center',
                            gap:'8px',
                            transition:'background 0.15s',
                          }}
                        >
                          <span>— No token (public vault) —</span>
                          {!selectedToken && <span style={{color:'var(--accent)', fontSize:'12px', flexShrink:0}}>✓</span>}
                        </div>
                        {sellerTokens.map(tok => {
                          const isSel = selectedToken?.address?.toLowerCase() === tok.address.toLowerCase()
                          return (
                            <div
                              key={tok.address}
                              role="option"
                              aria-selected={isSel}
                              onClick={() => { setSelectedToken(tok); setTokenDropdownOpen(false) }}
                              onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'rgba(197,52,0,0.1)' }}
                              onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent' }}
                              style={{
                                padding:'12px 16px',
                                fontSize:'13px',
                                fontFamily:'var(--font-mono)',
                                color: isSel ? 'var(--text-primary)' : 'var(--text-secondary)',
                                background: isSel ? 'rgba(197,52,0,0.1)' : 'transparent',
                                borderLeft: isSel ? '2px solid var(--accent)' : '2px solid transparent',
                                cursor:'pointer',
                                display:'flex',
                                justifyContent:'space-between',
                                alignItems:'center',
                                gap:'8px',
                                transition:'background 0.15s',
                              }}
                            >
                              <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{tok.name} ({tok.symbol}) — {tok.priceFormatted} · {tok.durationLabel}</span>
                              {isSel && <span style={{color:'var(--accent)', fontSize:'12px', flexShrink:0}}>✓</span>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  )}
                  {selectedToken && (
                    <div style={{marginTop:'8px', padding:'10px 12px', background:'rgba(197,52,0,0.08)', border:'1px solid rgba(197,52,0,0.15)', borderRadius:'2px', fontSize:'12px', fontFamily:'var(--font-mono)', color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap'}}>
                      <span style={{color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.12em', fontSize:'11px'}}>Selected:</span>
                      <span style={{color:'var(--text-primary)', fontWeight:600}}>{selectedToken.name} ({selectedToken.symbol})</span>
                      <span style={{color:'var(--text-muted)'}}>—</span>
                      <span>{selectedToken.priceFormatted} · {selectedToken.durationLabel}</span>
                      <span style={{color:'var(--accent)', marginLeft:'4px'}}>✓</span>
                    </div>
                  )}
                </div>
              )}

              {/* Create Token Form */}
              {showTokenCreate && (
                <div style={{marginTop:'16px', paddingTop:'16px', borderTop:'1px solid var(--hairline)'}}>
                  <h5 style={{margin:'0 0 12px 0', fontSize:'12px', fontWeight:700, color:'var(--text-primary)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.22em'}}>Create New Token</h5>
                  <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'10px', marginBottom:'12px'}}>
                    <div className="dv-input-group" style={{margin:0}}>
                      <label style={{display:'block', marginBottom:'8px', fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.22em'}}>Token Name</label>
                      <input
                        type="text"
                        value={tokenCreateState.name}
                        onChange={(e) => setTokenCreateState(prev => ({...prev, name: e.target.value}))}
                        placeholder="e.g., Gold Pass"
                        style={{
                          width:'100%',
                          padding:'16px',
                          fontSize:'14px',
                          fontFamily:'var(--font-mono)',
                          background:'var(--input-bg)',
                          border:'1px solid var(--hairline)',
                          borderRadius:'2px',
                          color:'var(--text-primary)',
                        }}
                      />
                    </div>
                    <div className="dv-input-group" style={{margin:0}}>
                      <label style={{display:'block', marginBottom:'8px', fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.22em'}}>Symbol</label>
                      <input
                        type="text"
                        value={tokenCreateState.symbol}
                        onChange={(e) => {
                          const v = e.target.value.toUpperCase()
                          setTokenCreateState((p) => ({ ...p, symbol: v }))
                        }}
                        placeholder="GOLD"
                        maxLength={10}
                        style={{
                          width:'100%',
                          padding:'16px',
                          fontSize:'14px',
                          fontFamily:'var(--font-mono)',
                          background:'var(--input-bg)',
                          border:'1px solid var(--hairline)',
                          borderRadius:'2px',
                          color:'var(--text-primary)',
                          textTransform:'uppercase',
                        }}
                      />
                    </div>
                    <div className="dv-input-group" style={{margin:0}}>
                      <label style={{display:'block', marginBottom:'8px', fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.22em'}}>Price (STRK)</label>
                      <input
                        type="number"
                        value={tokenCreateState.price}
                        onChange={(e) => setTokenCreateState(prev => ({...prev, price: e.target.value}))}
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        style={{
                          width:'100%',
                          padding:'16px',
                          fontSize:'14px',
                          fontFamily:'var(--font-mono)',
                          background:'var(--input-bg)',
                          border:'1px solid var(--hairline)',
                          borderRadius:'2px',
                          color:'var(--text-primary)',
                        }}
                      />
                    </div>
                    <div className="dv-input-group" style={{margin:0}}>
                      <label style={{display:'block', marginBottom:'8px', fontFamily:'var(--font-mono)', fontSize:'12px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.22em'}}>Duration (days)</label>
                      <select
                        value={tokenCreateState.duration}
                        onChange={(e) => setTokenCreateState(prev => ({...prev, duration: parseInt(e.target.value) || 30}))}
                        style={{
                          width:'100%',
                          padding:'16px',
                          fontSize:'14px',
                          fontFamily:'var(--font-mono)',
                          background:'var(--input-bg)',
                          border:'1px solid var(--hairline)',
                          borderRadius:'2px',
                          color:'var(--text-primary)',
                        }}
                      >
                        <option value={0}>Forever (no expiry)</option>
                        <option value={30}>30 days</option>
                        <option value={90}>90 days</option>
                        <option value={180}>180 days</option>
                        <option value={365}>1 year</option>
                      </select>
                    </div>
                  </div>
                  {tokenCreateError && <div className="dv-error" style={{marginBottom:'10px', fontSize:'12px'}}>{tokenCreateError}</div>}
                  <div style={{display:'flex', gap:'10px', justifyContent:'flex-end'}}>
                    <button
                      type="button"
                      onClick={() => { setShowTokenCreate(false); setTokenCreateError(null); }}
                      style={{
                        padding:'16px',
                        fontSize:'12px',
                        fontWeight:700,
                        fontFamily:'var(--font-mono)',
                        color:'var(--text-secondary)',
                        background:'transparent',
                        border:'1px solid var(--hairline)',
                        borderRadius:'2px',
                        cursor:'pointer',
                        textTransform:'uppercase',
                        letterSpacing:'0.14em',
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateToken}
                      disabled={tokenCreateLoading || !tokenCreateState.name.trim() || !tokenCreateState.symbol.trim()}
                      style={{
                        padding:'16px',
                        fontSize:'12px',
                        fontWeight:600,
                        fontFamily:'var(--font-mono)',
                        color:'#fff',
                        background: tokenCreateState.name.trim() && tokenCreateState.symbol.trim() ? 'var(--accent)' : 'rgba(197,52,0,0.4)',
                        border:'1px solid transparent',
                        borderRadius:'2px',
                        cursor: tokenCreateState.name.trim() && tokenCreateState.symbol.trim() ? 'pointer' : 'not-allowed',
                        opacity: tokenCreateLoading ? 0.7 : 1,
                        textTransform:'uppercase',
                        letterSpacing:'0.14em',
                      }}
                    >
                      {tokenCreateLoading ? 'Creating…' : 'Create Token'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Invite Link Generator — pure group invite without file (file_cid=0x0) */}
          {connected && isStrk20 && (
            <div style={{marginTop:'16px', padding:'16px', background:'var(--raised)', border:'1px solid var(--hairline)', borderRadius:'2px'}}>
              <h4 style={{margin:'0 0 8px 0', fontSize:'12px', fontWeight:700, color:'var(--text-primary)', fontFamily:'var(--font-mono)', textTransform:'uppercase', letterSpacing:'0.22em'}}>Generate Invite Link <span style={{color:'var(--text-muted)', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:'11px'}}>— No File</span></h4>
              <p className="dv-hint" style={{margin:'0 0 12px 0', fontSize:'12px', lineHeight:'1.5', color:'var(--text-muted)'}}>
                Create a shareable invite link gated by the selected soulbound token above. Each link is a distinct vault (file_cid=0x0).
              </p>
              <div style={{marginBottom:'12px', padding:'10px 12px', background:'var(--input-bg)', border:'1px solid var(--hairline)', borderRadius:'2px', fontSize:'12px', fontFamily:'var(--font-mono)'}}>
                <span style={{color:'var(--text-muted)'}}>Token gate: </span>
                <strong style={{color: selectedToken ? 'var(--accent)' : 'var(--text-secondary)'}}>
                  {selectedToken ? `${selectedToken.name} (${selectedToken.symbol}) — ${selectedToken.address.slice(0,10)}...` : 'No token selected'}
                </strong>
              </div>
              {!selectedToken && !inviteResult && (
                <p className="dv-hint" style={{margin:'0 0 12px 0', fontSize:'12px', color:'var(--text-secondary)', lineHeight:'1.5'}}>
                  Select a soulbound token above to create an invite link
                </p>
              )}
              {inviteError && <div className="dv-error" style={{marginBottom:'10px', fontSize:'12px'}}>{inviteError}</div>}
              {!inviteResult ? (
                <button
                  type="button"
                  onClick={handleGenerateInvite}
                  disabled={inviteLoading || !connected || !selectedToken}
                  className="dv-btn-primary"
                  style={{ opacity: inviteLoading ? 0.7 : 1 }}
                >
                  {inviteLoading ? 'Creating invite…' : 'Generate Invite Link'}
                </button>
              ) : (
                <div style={{marginTop:'12px'}}>
                  <div style={{display:'flex', flexDirection:'column', gap:'12px', marginBottom:'12px'}}>
                    <div className="dv-cid-box" style={{padding:'12px'}}>
                      <div className="dv-cid-header">
                        <label>Invite Link (/v/)</label>
                        <button onClick={() => copyToClipboard(inviteResult.link, 'inviteV', setInviteCopied)} className="dv-copy">
                          {inviteCopied === 'inviteV' ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                      <code style={{color:'var(--accent)', fontSize:'11px', wordBreak:'break-all', display:'block'}}>{inviteResult.link}</code>
                    </div>
                    <div className="dv-cid-box" style={{padding:'12px'}}>
                      <div className="dv-cid-header">
                        <label>Alias (/join/)</label>
                        <button onClick={() => copyToClipboard(inviteResult.joinLink, 'inviteJoin', setInviteCopied)} className="dv-copy">
                          {inviteCopied === 'inviteJoin' ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                      <code style={{color:'var(--accent)', fontSize:'11px', wordBreak:'break-all', display:'block'}}>{inviteResult.joinLink}</code>
                    </div>
                    <div style={{marginTop:'8px', fontSize:'11px', color:'var(--text-muted)'}}>
                      Vault UID: {inviteResult.vaultUid}
                    </div>
                    <div style={{marginTop:'4px', fontSize:'11px', color:'var(--text-muted)'}}>
                      Token gate: {inviteResult.tokenGate === '0x0' ? 'Public (0x0)' : inviteResult.tokenGate}
                      {inviteResult.tokenName ? ` — ${inviteResult.tokenName}` : ''}
                    </div>
                    <div className="dv-info-box" style={{marginTop:'8px', fontSize:'12px', padding:'8px 12px'}}>
                      Share this link — buyer needs token if gated.
                    </div>
                  </div>
                  <div style={{display:'flex', gap:'8px'}}>
                    <button
                      type="button"
                      onClick={() => setInviteResult(null)}
                      className="dv-btn-secondary"
                      style={{ flex:1 }}
                    >
                      Create Another Invite
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(inviteResult.link, 'inviteV', setInviteCopied)}
                      className="dv-btn-primary"
                      style={{ flex:1 }}
                    >
                      {inviteCopied === 'inviteV' ? '✓ Copied' : 'Copy Link'}
                    </button>
                  </div>
                </div>
              )}
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
            {price && !isNaN(parseFloat(price)) && parseFloat(price) > 0 && (
              <div style={{marginTop:'8px', fontSize:'12px', color:'rgba(255,255,255,0.7)', background:'rgba(255,255,255,0.06)', padding:'8px 10px', borderRadius:'2px'}}>
                Platform fee 1% — you will receive 99% ({(parseFloat(price) * 0.99).toFixed(4)} STRK). No gas included.
                <div style={{fontSize:'11px', color:'var(--text-muted)', marginTop:'2px'}}>
                  Fee: {(parseFloat(price) * 0.01).toFixed(4)} STRK · Seller receives 99% at purchase time
                </div>
              </div>
            )}
          </div>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={!connected ? onConnect : handleUpload}
            disabled={connected && (!file || !price)}
          >
            {!connected ? 'Connect Wallet' :
             `Pay ${feeInfo?.feeFormatted || '0.5'} STRK & Upload`}
          </button>
        </>
      )}

      {step === 1 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Encrypting and uploading to Fil One...</p>
        </div>
      )}

      {step === 2 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Creating vault on-chain...</p>
          <small style={{color: 'rgba(255,255,255,0.4)', marginTop: '8px'}}>
            Approve the transaction in your wallet (fee + vault creation in one tx).
          </small>
        </div>
      )}

      {step === 3 && result && (
        <>
          <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', marginBottom:'12px'}}>
            <div className="dv-pqc-bubble" onClick={() => setShowPqcTip(!showPqcTip)} style={{position:'relative', display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'11px', padding:'5px 10px', borderRadius:'999px', background: result.pqc ? 'rgba(197,52,0,0.12)' : 'rgba(239,68,68,0.12)', border: result.pqc ? '1px solid rgba(197,52,0,0.25)' : '1px solid rgba(239,68,68,0.25)', color: result.pqc ? '#c53400' : '#ef4444', cursor:'pointer'}}>
              <span style={{width:'5px', height:'5px', borderRadius:'50%', background: result.pqc ? '#c53400' : '#ef4444', display:'inline-block'}}></span>
              {result.pqc ? 'PQC secure' : 'Non-PQC'}
              <span style={{width:'14px', height:'14px', borderRadius:'50%', background: result.pqc ? 'rgba(197,52,0,0.15)' : 'rgba(239,68,68,0.15)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'400', color: result.pqc ? '#c53400' : '#ef4444'}}>i</span>
              <div className="dv-pqc-tooltip" style={{position:'absolute', top:'calc(100% + 8px)', right:0, width:'280px', background:'var(--raised)', border:'1px solid var(--hairline)', borderRadius:'2px', padding:'12px 14px', fontSize:'13px', lineHeight:'1.6', color:'var(--text-secondary)', boxShadow:'0 8px 24px rgba(0,0,0,0.5)', opacity: showPqcTip ? 1 : 0, pointerEvents: showPqcTip ? 'auto' : 'none', transition:'opacity 0.15s', zIndex:10, textAlign:'left'}}>
                {result.pqc ? 'This vault was created over a TLS 1.3 connection confirmed by the edge — quantum-safe against harvest-now-decrypt-later attacks.' : 'This vault was created without PQC protection (HNDL risk). New uploads from modern browsers are marked PQC secure.'}
              </div>
            </div>
          </div>
          <div>
            <h3 className="dv-title">File Uploaded & Vault Created</h3>
            <p className="dv-hint">Share this link privately with your buyer. They'll need this link + a valid soulbound token to access the vault.</p>
          </div>

          <div className="dv-cid-box">
            <div className="dv-cid-header">
              <label>Shareable Vault Link</label>
              <button className="dv-copy" onClick={() => copyToClipboard(`${typeof window !== 'undefined' ? window.location.origin : ''}/v/${result.vaultUid}`, 'vaultUrl', setCopied)}>
                {copied === 'vaultUrl' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <code>{typeof window !== 'undefined' ? window.location.origin : ''}/v/{result.vaultUid}</code>
            <small style={{color: 'rgba(255,255,255,0.3)', fontSize: '10px', display: 'block', marginTop: '4px'}}>
              Vault UID: {result.vaultUid}
            </small>
          </div>

          <div className="dv-cid-box">
            <div className="dv-cid-header">
              <label>Claim Secret (share privately — needed to decrypt)</label>
              <button className="dv-copy" onClick={() => copyToClipboard(result.claimSecret, 'secret', setCopied)}>
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
          <div className="dv-info-row">
            <span>PQC:</span>
            <strong style={{color: result.pqc ? '#c53400' : '#ef4444', fontSize:'12px'}}>{result.pqc ? '✓ Created with PQC' : '⚠ Created without PQC'}</strong>
          </div>

          <button className="dv-btn-secondary" onClick={reset}>Upload Another</button>
        </>
      )}
    </>
  )
}
