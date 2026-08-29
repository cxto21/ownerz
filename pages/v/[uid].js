import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { readLock, identifierToFelt, unlock, secretToOnChain } from '../../lib/key-onchain/index.js'
import { connectWallet, getAvailableWallets, waitForWallets } from '../../lib/starknet.js'
import { checkAccess, mintAccess, getTokenInfo, revealShieldedAccess } from '../../lib/access-token.js'
import { downloadKeySeed, downloadEncryptedFile } from '../../lib/storage/index.js'
import { unwrapKeySeed, decryptData, hexToArray } from '../../lib/crypto/index.js'

/** Normalize starknet.js address (BigInt/object) to hex string */
function toHexAddress(addr) {
  if (!addr) return '0x0'
  if (typeof addr === 'string') return addr
  if (typeof addr === 'bigint') return addr === 0n ? '0x0' : '0x' + addr.toString(16)
  if (typeof addr === 'object' && addr !== null) {
    // starknet.js sometimes returns {type: 'RAWDATAFELT', ...}
    if (addr.low !== undefined) {
      const bi = BigInt(addr.low) + (BigInt(addr.high) << 128n)
      return bi === 0n ? '0x0' : '0x' + bi.toString(16)
    }
    if (addr.toString) return addr.toString()
  }
  try { const bi = BigInt(addr); return bi === 0n ? '0x0' : '0x' + bi.toString(16) } catch { return String(addr) }
}

/**
 * Vault access page — /v/[uid]
 * vault_uid is the random 128-bit value; never stored on-chain.
 * identifier = hash(vault_uid) is what lives on-chain.
 */
export default function VaultAccess() {
  const router = useRouter()
  const { uid } = router.query

  const [vaultInfo, setVaultInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [account, setAccount] = useState(null)
  const [claimStatus, setClaimStatus] = useState(null) // null | 'claiming' | 'downloading' | 'decrypting' | 'claimed' | 'error'
  const [claimSecret, setClaimSecret] = useState('')
  const [decryptedFile, setDecryptedFile] = useState(null) // { url, name, type }
  const [copied, setCopied] = useState(null)
  const [tokenInfo, setTokenInfo] = useState(null) // soulbound token info
  const [hasToken, setHasToken] = useState(false) // buyer has soulbound token?
  const [buyingToken, setBuyingToken] = useState(false) // buying in progress

  const copyToClipboard = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* ignore */ }
  }

  // Auto-fill claim secret from URL query param (?secret=...)
  useEffect(() => {
    if (!router.isReady) return
    const qs = router.query.secret
    if (qs && typeof qs === 'string' && !claimSecret) {
      setClaimSecret(qs)
    }
  }, [router.isReady, router.query.secret])

  // Load vault info when uid is available
  useEffect(() => {
    if (!uid || !router.isReady) return

    const loadVault = async () => {
      try {
        setLoading(true)
        setError(null)

        // Compute identifier from vault_uid
        const identifier = await identifierToFelt(uid)

        // Read on-chain vault info
        const info = await readLock(identifier)

        if (!info) {
          setError('Vault not found. The link may be invalid or the vault has been removed.')
          setLoading(false)
          return
        }

        setVaultInfo({ ...info, identifier, vaultUid: uid })

        // If vault has a token_gate, load token info
        const tokenGate = toHexAddress(info.vault?.token_gate)
        if (tokenGate && tokenGate !== '0x0' && tokenGate !== '0') {
          try {
            const tInfo = await getTokenInfo(tokenGate)
            setTokenInfo(tInfo)
          } catch (tokErr) {
            console.warn('[VaultAccess] Failed to load token info:', tokErr)
          }
        }
      } catch (err) {
        console.error('[VaultAccess] Error loading vault:', err)
        setError('Failed to load vault information. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    loadVault()
  }, [uid, router.isReady])

  // Auto-connect wallet and check token access
  useEffect(() => {
    const connect = async () => {
      try {
        const wallets = await waitForWallets(3, 1000)
        if (wallets.length > 0) {
          const result = await connectWallet(wallets[0])
          setAccount(result.account) // extract actual account, not the wrapper
        }
      } catch { /* no wallet detected */ }
    }
    connect()
  }, [])

  // Check token access when account + vaultInfo are available (includes STRK20 shielded check)
  useEffect(() => {
    if (!account || !vaultInfo) return

    const checkTokenAccess = async () => {
      const tokenGate = toHexAddress(vaultInfo.vault?.token_gate)
      if (!tokenGate || tokenGate === '0x0' || tokenGate === '0') {
        setHasToken(true) // no gate = public vault / public invite
        return
      }

      try {
        const addr = toHexAddress(account.address || account.contractAddress)
        console.log('[VaultAccess] Checking token access for:', { tokenGate, addr })
        const access = await checkAccess(tokenGate, addr)
        console.log('[VaultAccess] checkAccess result:', access)
        let hasAccess = access.hasAccess
        // STRK20 shielded balance check: checkAccess || revealShieldedAccess
        try {
          const shielded = await revealShieldedAccess(account, tokenGate)
          if (shielded.hasShieldedAccess) hasAccess = true
        } catch (shieldErr) {
          console.warn('[VaultAccess] revealShieldedAccess failed:', shieldErr?.message)
        }
        setHasToken(hasAccess)
      } catch (e) {
        console.warn('[VaultAccess] checkAccess failed:', e)
        // Fallback: try shielded alone
        try {
          const shielded = await revealShieldedAccess(account, tokenGate)
          setHasToken(!!shielded.hasShieldedAccess)
        } catch {
          setHasToken(false)
        }
      }
    }

    checkTokenAccess()
  }, [account, vaultInfo])

  const handleConnect = async () => {
    try {
      const wallets = getAvailableWallets()
      if (wallets.length === 0) {
        setError('No wallet detected. Install Argent X or Braavos.')
        return
      }
      const result = await connectWallet(wallets[0])
      setAccount(result.account) // extract actual account, not the wrapper
      setError(null)
    } catch (err) {
      setError('Failed to connect wallet: ' + err.message)
    }
  }

  const handleBuyToken = async () => {
    if (!account || !vaultInfo) return

    const tokenGate = toHexAddress(vaultInfo.vault?.token_gate)
    if (!tokenGate || tokenGate === '0x0' || tokenGate === '0') return

    try {
      setBuyingToken(true)
      setError(null)

      const result = await mintAccess(account, tokenGate)

      // Wait for tx
      if (result?.transaction_hash) {
        try {
          await account.provider.waitForTransaction(result.transaction_hash, { timeout: 60000 })
        } catch (waitErr) {
          console.warn('waitForTransaction failed:', waitErr.message)
        }
      }

      // Re-check access after purchase (public + shielded)
      const addr = account.address || account.contractAddress
      const access = await checkAccess(tokenGate, addr)
      let hasAccess = access.hasAccess
      try {
        const shielded = await revealShieldedAccess(account, tokenGate)
        if (shielded.hasShieldedAccess) hasAccess = true
      } catch {}
      setHasToken(hasAccess)

      if (!hasAccess) {
        setError('Token purchased but access not yet active. Please wait a moment and try again.')
      }
    } catch (err) {
      console.error('[VaultAccess] Buy token error:', err)
      setError('Failed to buy access token: ' + err.message)
    } finally {
      setBuyingToken(false)
    }
  }

  const handleClaim = async () => {
    if (!account || !claimSecret || !vaultInfo) return

    try {
      setClaimStatus('claiming')
      setError(null)

      // Convert claim secret hex to u16 proof
      const proof = secretToOnChain(claimSecret)
      console.log('[VaultAccess] Claiming vault:', { identifier: vaultInfo.identifier, proof, secretLen: claimSecret.length })

      // Step 1: Unlock on-chain (claim vault)
      const result = await unlock({
        account,
        identifier: vaultInfo.identifier,
        proof,
      })

      // Wait for tx — if it fails, surface the error
      if (result?.transaction_hash) {
        console.log('[VaultAccess] Claim tx submitted:', result.transaction_hash)
        try {
          const txResult = await account.provider.waitForTransaction(result.transaction_hash, { timeout: 60000 })
          // Check execution status
          if (txResult?.execution_status === 'REVERTED') {
            const reason = txResult?.revert_reason || 'Transaction reverted on-chain'
            throw new Error('Claim failed: ' + reason)
          }
        } catch (waitErr) {
          // If waitForTransaction throws, the tx likely reverted
          if (waitErr.message?.includes('Claim failed:')) throw waitErr
          console.warn('[VaultAccess] waitForTransaction error:', waitErr.message)
          throw new Error('Transaction failed — the claim secret may be incorrect or the vault may have already been claimed.')
        }
      }

      // Step 2: Get file_cid from vault (normalize BigInt to hex string)
      const fileCid = toHexAddress(vaultInfo.vault?.file_cid)
      if (!fileCid || fileCid === '0x0' || fileCid === '0') {
        throw new Error('No file_cid found in vault — cannot download file')
      }

      // Step 3: Download key seed from storage
      setClaimStatus('downloading')
      const keySeedCiphertext = await downloadKeySeed(fileCid)
      if (!keySeedCiphertext) throw new Error('Key seed not found in storage')

      // Step 4: Unwrap key seed with claim secret → recover ML-KEM768 secret key
      const cleanSecret = String(claimSecret).trim().toLowerCase()
      let secretKeyHex
      try {
        secretKeyHex = await unwrapKeySeed(keySeedCiphertext, cleanSecret)
      } catch (e) {
        if (e.name === 'OperationError' || String(e.message).includes('Operation')) {
          throw new Error('Invalid claim secret — unwrap failed')
        }
        throw new Error('Unwrap failed: ' + (e.message || String(e)))
      }
      const secretKey = hexToArray(secretKeyHex)

      // Step 5: Download encrypted file from storage
      setClaimStatus('decrypting')
      const encryptedData = await downloadEncryptedFile(fileCid)
      if (!encryptedData) throw new Error('Encrypted file not found in storage')

      // Step 6: Decrypt file
      let data, fileName, fileType
      try {
        const dec = await decryptData(encryptedData, secretKey)
        data = dec.data
        fileName = dec.fileName
        fileType = dec.fileType
      } catch (e) {
        throw new Error('Decryption failed — file may be corrupted: ' + (e.message || String(e)))
      }

      // Step 7: Create download URL
      const blob = new Blob([data], { type: fileType })
      const downloadUrl = URL.createObjectURL(blob)

      setClaimStatus('claimed')
      setDecryptedFile({ url: downloadUrl, name: fileName, type: fileType })
    } catch (err) {
      console.error('[VaultAccess] Claim error:', err)
      setClaimStatus('error')
      setError(err.message || 'Claim failed')
    }
  }

  // Download only (for already-claimed vaults — no on-chain unlock)
  const handleDownloadOnly = async () => {
    if (!claimSecret || !vaultInfo) return

    try {
      setError(null)
      setClaimStatus('downloading')

      // Get file_cid from vault
      const fileCid = toHexAddress(vaultInfo.vault?.file_cid)
      if (!fileCid || fileCid === '0x0' || fileCid === '0') {
        throw new Error('No file_cid found in vault')
      }

      // Download key seed
      const keySeedCiphertext = await downloadKeySeed(fileCid)
      if (!keySeedCiphertext) throw new Error('Key seed not found in storage')

      // Unwrap key seed with claim secret
      const cleanSecret = String(claimSecret).trim().toLowerCase()
      let secretKeyHex
      try {
        secretKeyHex = await unwrapKeySeed(keySeedCiphertext, cleanSecret)
      } catch (e) {
        throw new Error('Invalid claim secret — unwrap failed')
      }
      const secretKey = hexToArray(secretKeyHex)

      // Download encrypted file
      setClaimStatus('decrypting')
      const encryptedData = await downloadEncryptedFile(fileCid)
      if (!encryptedData) throw new Error('Encrypted file not found in storage')

      // Decrypt
      let data, fileName, fileType
      try {
        const dec = await decryptData(encryptedData, secretKey)
        data = dec.data
        fileName = dec.fileName
        fileType = dec.fileType
      } catch (e) {
        throw new Error('Decryption failed: ' + (e.message || String(e)))
      }

      // Create download URL
      const blob = new Blob([data], { type: fileType })
      const downloadUrl = URL.createObjectURL(blob)

      setClaimStatus('claimed')
      setDecryptedFile({ url: downloadUrl, name: fileName, type: fileType })
    } catch (err) {
      console.error('[VaultAccess] Download error:', err)
      setClaimStatus('error')
      setError(err.message || 'Download failed')
    }
  }

  // Format price from u256
  const formatPrice = (price) => {
    if (!price) return '0'
    try {
      const big = typeof price === 'bigint' ? price : BigInt(price)
      return (Number(big) / 1e18).toFixed(4)
    } catch {
      return '0'
    }
  }

  // Format address for display
  const shortAddr = (addr) => {
    if (!addr) return '—'
    const s = String(addr)
    return s.length > 16 ? `${s.slice(0, 8)}...${s.slice(-6)}` : s
  }

  // Detect invite vault (file_cid == 0x0) — pure group invite without file
  const isInvite = (() => {
    if (!vaultInfo?.vault) return false
    const hasFileCid = 'file_cid' in vaultInfo.vault || 'fileCid' in vaultInfo.vault
    // For old vaults without file_cid field, treat as file vault (not invite)
    if (!hasFileCid) return false
    return toHexAddress(vaultInfo.vault?.file_cid) === '0x0'
  })()
  const tokenGateHex = vaultInfo ? toHexAddress(vaultInfo.vault?.token_gate) : '0x0'
  const isPublicInvite = isInvite && (tokenGateHex === '0x0' || tokenGateHex === '0')

  if (loading) {
    return (
      <>
        <Head><title>Loading Vault — Ownerz</title></Head>
        <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: '#a1a1aa' }}>
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>⏳</div>
            <div>Loading vault...</div>
          </div>
        </div>
      </>
    )
  }

  if (error && !vaultInfo) {
    return (
      <>
        <Head><title>Vault Not Found — Ownerz</title></Head>
        <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: '#ef4444', maxWidth: '400px', padding: '24px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔒</div>
            <h2 style={{ color: '#fff', marginBottom: '8px' }}>Vault Not Found</h2>
            <p style={{ color: '#a1a1aa', fontSize: '14px' }}>{error}</p>
            <button
              onClick={() => router.push('/')}
              style={{
                marginTop: '20px', padding: '10px 20px', borderRadius: '2px',
                background: '#c53400', color: '#fff', border: 'none', cursor: 'pointer',
                fontSize: '14px', fontWeight: '600'
              }}
            >
              Go Home
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Head>
        <title>Vault Access — Ownerz</title>
        <meta name="description" content="Access encrypted vault on Ownerz data marketplace" />
      </Head>
      <div style={{ minHeight: '100vh', background: '#0a0a0a', padding: '24px' }}>
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h1 style={{ color: '#fff', fontSize: '24px', fontWeight: '700', marginBottom: '4px' }}>
              {isInvite ? '🔗 Exclusive Invite' : '🔒 Encrypted Vault'}
            </h1>
            <p style={{ color: '#71717a', fontSize: '13px' }}>
              {isInvite
                ? (isPublicInvite ? 'Public invite — no token required' : 'Invite gated by soulbound token')
                : 'You need a valid soulbound token to access this vault'}
            </p>
          </div>

          {/* Vault Info Card */}
          {vaultInfo && (
            <div style={{
              background: '#18181b', border: '1px solid #27272a', borderRadius: '12px',
              padding: '20px', marginBottom: '20px'
            }}>
              {/* Top badges */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px', flexWrap:'wrap' }}>
                <span style={{
                  fontSize: '11px', padding: '4px 10px', borderRadius: '999px',
                  background: isInvite ? 'rgba(197,52,0,0.12)' : 'rgba(197,52,0,0.12)',
                  border: `1px solid ${isInvite ? 'rgba(197,52,0,0.25)' : 'rgba(197,52,0,0.15)'}`,
                  color: isInvite ? '#c53400' : '#c53400'
                }}>
                  {isInvite ? '🔗 Invite Link' : '🔒 Encrypted Vault'}
                </span>
                <span style={{
                  fontSize: '11px', padding: '4px 10px', borderRadius: '999px',
                  background: vaultInfo.pqc ? 'rgba(197,52,0,0.12)' : 'rgba(239,68,68,0.12)',
                  border: `1px solid ${vaultInfo.pqc ? 'rgba(197,52,0,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  color: vaultInfo.pqc ? '#c53400' : '#ef4444'
                }}>
                  {vaultInfo.pqc ? '✓ PQC Secure' : '⚠ Non-PQC'}
                </span>
              </div>

              {/* Price — hidden for invite (price 0) */}
              {!isInvite && (
                <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                  <div style={{ color: '#71717a', fontSize: '12px', marginBottom: '4px' }}>Price</div>
                  <div style={{ color: '#fff', fontSize: '28px', fontWeight: '700' }}>
                    {formatPrice(vaultInfo.meta?.price)} STRK
                  </div>
                </div>
              )}
              {isInvite && (
                <div style={{ textAlign: 'center', marginBottom: '16px', padding:'10px', background: 'rgba(197,52,0,0.08)', border:'1px solid rgba(197,52,0,0.15)', borderRadius:'2px' }}>
                  <div style={{ color: '#c53400', fontSize: '13px', fontWeight:600 }}>{isPublicInvite ? 'Public Invite — No Token Needed' : 'Gated Invite'}</div>
                  <div style={{ color:'var(--text-secondary)', fontSize:'12px', marginTop:'4px', wordBreak:'break-all' }}>
                    Gate: {tokenGateHex === '0x0' ? '0x0 (public)' : `${shortAddr(tokenGateHex)}${tokenInfo ? ` — ${tokenInfo.name} (${tokenInfo.symbol})` : ''}`}
                  </div>
                </div>
              )}

              {/* Details */}
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#71717a' }}>Seller</span>
                  <span style={{ color: '#d4d4d8', fontFamily: 'monospace' }}>{shortAddr(vaultInfo.seller)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#71717a' }}>Status</span>
                  <span style={{ color: vaultInfo.isClaimed ? '#ef4444' : '#c53400' }}>
                    {vaultInfo.isClaimed ? 'Claimed' : 'Available'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#71717a' }}>Type</span>
                  <span style={{ color: '#d4d4d8' }}>{isInvite ? 'Invite (no file)' : 'File Vault'}</span>
                </div>
                {!isInvite && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#71717a' }}>Platform Fee</span>
                    <span style={{ color: '#d4d4d8' }}>{vaultInfo.platformFeeBps || 100} bps</span>
                  </div>
                )}
                {isInvite && tokenGateHex !== '0x0' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ color: '#71717a' }}>Token Gate</span>
                    <span style={{ color: '#d4d4d8', fontFamily: 'monospace' }}>{shortAddr(tokenGateHex)}</span>
                  </div>
                )}
              </div>

              {/* Shareable Links — same .dv-cid-box / .dv-copy pattern as SellFlow */}
              <div className="dv-cid-box" style={{ marginTop: '16px' }}>
                <div className="dv-cid-header">
                  <label>Shareable Link</label>
                  <button className="dv-copy" onClick={() => copyToClipboard(`${window.location.origin}/v/${uid}`, 'link')}>
                    {copied === 'link' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <code style={{ fontSize: '11px' }}>{typeof window !== 'undefined' ? window.location.origin : ''}/v/{uid}</code>
              </div>
              <div className="dv-cid-box" style={{ marginTop: '8px' }}>
                <div className="dv-cid-header">
                  <label>Alias (/join/)</label>
                  <button className="dv-copy" onClick={() => copyToClipboard(`${window.location.origin}/join/${uid}`, 'join')}>
                    {copied === 'join' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <code style={{ fontSize: '11px' }}>{typeof window !== 'undefined' ? window.location.origin : ''}/join/{uid}</code>
              </div>
            </div>
          )}

          {/* Claim Section — invite vs file branching */}
          {vaultInfo && !vaultInfo.isClaimed && isInvite && (
            <div style={{
              background: '#18181b', border: '1px solid #27272a', borderRadius: '12px',
              padding: '20px', marginBottom: '20px'
            }}>
              {!account ? (
                <>
                  <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '12px' }}>Join Invite</h3>
                  <p style={{ color: '#a1a1aa', fontSize: '13px', marginBottom: '12px' }}>
                    Connect your wallet to check access for this exclusive invite.
                  </p>
                  <button
                    onClick={handleConnect}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '2px',
                      background: '#c53400', color: '#fff', border: 'none',
                      cursor: 'pointer', fontSize: '14px', fontWeight: '600'
                    }}
                  >
                    Connect Wallet
                  </button>
                </>
              ) : isPublicInvite ? (
                <div style={{
                  background: 'rgba(197,52,0,0.08)', border: '1px solid rgba(197,52,0,0.2)',
                  borderRadius: '2px', padding: '14px', textAlign:'center'
                }}>
                  <div style={{ fontSize:'24px', marginBottom:'8px' }}>✓</div>
                  <div style={{ color:'#c53400', fontSize:'15px', fontWeight:600 }}>Joined — public invite</div>
                  <p style={{ color:'#a1a1aa', fontSize:'12px', marginTop:'6px' }}>No token required. You have access to this group invite.</p>
                </div>
              ) : !hasToken ? (
                <>
                  <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '12px' }}>Buy Access Token to Join</h3>
                  <p style={{ color: '#a1a1aa', fontSize: '13px', marginBottom: '16px' }}>
                    This invite requires a soulbound access token. Purchase it to join.
                  </p>
                  {tokenInfo && (
                    <div style={{
                      background: '#0f0f11', border: '1px solid #27272a', borderRadius: '2px',
                      padding: '14px', marginBottom: '16px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#71717a', fontSize: '12px' }}>Token</span>
                        <span style={{ color: '#fff', fontSize: '13px', fontWeight: '600' }}>
                          {tokenInfo.name || 'Access Token'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#71717a', fontSize: '12px' }}>Price</span>
                        <span style={{ color: '#c53400', fontSize: '13px', fontWeight: '600' }}>
                          {tokenInfo.priceFormatted || 'Free'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#71717a', fontSize: '12px' }}>Duration</span>
                        <span style={{ color: '#d4d4d8', fontSize: '13px' }}>
                          {tokenInfo.durationLabel || 'Forever'}
                        </span>
                      </div>
                    </div>
                  )}
                  {error && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>
                  )}
                  <button
                    onClick={handleBuyToken}
                    disabled={buyingToken}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '2px',
                      background: buyingToken ? '#27272a' : '#c53400',
                      color: '#fff', border: 'none',
                      cursor: buyingToken ? 'not-allowed' : 'pointer',
                      fontSize: '14px', fontWeight: '600'
                    }}
                  >
                    {buyingToken ? 'Buying...' : `Buy Access Token${tokenInfo?.priceFormatted ? ` (${tokenInfo.priceFormatted})` : ''}`}
                  </button>
                </>
              ) : (
                <div style={{
                  background: 'rgba(197,52,0,0.08)', border: '1px solid rgba(197,52,0,0.2)',
                  borderRadius: '2px', padding: '14px', textAlign:'center'
                }}>
                  <div style={{ fontSize:'24px', marginBottom:'8px' }}>✓</div>
                  <div style={{ color:'#c53400', fontSize:'15px', fontWeight:600 }}>Joined — you have the required token</div>
                  <p style={{ color:'#a1a1aa', fontSize:'12px', marginTop:'6px' }}>No claim needed. You can access the gated content / group.</p>
                  {tokenInfo && (
                    <div style={{ marginTop:'10px', fontSize:'12px', color:'#71717a' }}>
                      Token: {tokenInfo.name} ({tokenInfo.symbol})
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {vaultInfo && !vaultInfo.isClaimed && !isInvite && (
            <div style={{
              background: '#18181b', border: '1px solid #27272a', borderRadius: '12px',
              padding: '20px', marginBottom: '20px'
            }}>
              <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '12px' }}>
                {hasToken ? 'Claim Vault' : 'Buy Access Token'}
              </h3>

              {!account ? (
                <>
                  <p style={{ color: '#a1a1aa', fontSize: '13px', marginBottom: '12px' }}>
                    Connect your wallet to purchase the access token and claim this vault.
                  </p>
                  <button
                    onClick={handleConnect}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '2px',
                      background: '#c53400', color: '#fff', border: 'none',
                      cursor: 'pointer', fontSize: '14px', fontWeight: '600'
                    }}
                  >
                    Connect Wallet
                  </button>
                </>
              ) : !hasToken ? (
                <>
                  {/* Token purchase required */}
                  <p style={{ color: '#a1a1aa', fontSize: '13px', marginBottom: '16px' }}>
                    This vault requires a soulbound access token to unlock. The token proves you have permission to access this data.
                  </p>

                  {/* Token info card */}
                  {tokenInfo && (
                    <div style={{
                      background: '#0f0f11', border: '1px solid #27272a', borderRadius: '2px',
                      padding: '14px', marginBottom: '16px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#71717a', fontSize: '12px' }}>Token</span>
                        <span style={{ color: '#fff', fontSize: '13px', fontWeight: '600' }}>
                          {tokenInfo.name || 'Access Token'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ color: '#71717a', fontSize: '12px' }}>Price</span>
                        <span style={{ color: '#c53400', fontSize: '13px', fontWeight: '600' }}>
                          {tokenInfo.priceFormatted || 'Free'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: '#71717a', fontSize: '12px' }}>Duration</span>
                        <span style={{ color: '#d4d4d8', fontSize: '13px' }}>
                          {tokenInfo.durationLabel || 'Forever'}
                        </span>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>
                  )}

                  <button
                    onClick={handleBuyToken}
                    disabled={buyingToken}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '2px',
                      background: buyingToken ? '#27272a' : '#c53400',
                      color: '#fff', border: 'none',
                      cursor: buyingToken ? 'not-allowed' : 'pointer',
                      fontSize: '14px', fontWeight: '600'
                    }}
                  >
                    {buyingToken ? 'Buying...' : `Buy Access Token${tokenInfo?.priceFormatted ? ` (${tokenInfo.priceFormatted})` : ''}`}
                  </button>
                </>
              ) : (
                <>
                  {/* Has token — show claim form */}
                  <div style={{
                    background: 'rgba(197,52,0,0.08)', border: '1px solid rgba(197,52,0,0.2)',
                    borderRadius: '2px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#c53400'
                  }}>
                    ✓ You have the required access token
                  </div>

                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ color: '#71717a', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                      Claim Secret
                    </label>
                    <input
                      type="text"
                      value={claimSecret}
                      onChange={(e) => setClaimSecret(e.target.value)}
                      placeholder="Enter claim secret (hex)"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: '2px',
                        background: '#0f0f11', border: '1px solid #27272a',
                        color: '#fff', fontSize: '13px', fontFamily: 'monospace',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  {error && (
                    <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>
                  )}

                  <button
                    onClick={handleClaim}
                    disabled={!claimSecret || claimStatus === 'claiming' || claimStatus === 'downloading' || claimStatus === 'decrypting'}
                    style={{
                      width: '100%', padding: '12px', borderRadius: '2px',
                      background: claimStatus === 'claiming' || claimStatus === 'downloading' || claimStatus === 'decrypting' ? '#27272a' : '#c53400',
                      color: '#fff', border: 'none',
                      cursor: claimStatus === 'claiming' || claimStatus === 'downloading' || claimStatus === 'decrypting' ? 'not-allowed' : 'pointer',
                      fontSize: '14px', fontWeight: '600'
                    }}
                  >
                    {claimStatus === 'claiming' ? 'Claiming on-chain...'
                      : claimStatus === 'downloading' ? 'Downloading encrypted file...'
                      : claimStatus === 'decrypting' ? 'Decrypting...'
                      : claimStatus === 'claimed' && decryptedFile ? '✓ Decrypted!'
                      : 'Claim & Decrypt'}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Download Section — after successful claim + decrypt — only for file vaults */}
          {!isInvite && claimStatus === 'claimed' && decryptedFile && (
            <div style={{
              background: '#18181b', border: '1px solid rgba(197,52,0,0.3)', borderRadius: '12px',
              padding: '20px', marginBottom: '20px'
            }}>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔓</div>
                <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '4px' }}>File Decrypted</h3>
                <p style={{ color: '#71717a', fontSize: '13px' }}>
                  Your file has been decrypted and is ready to download.
                </p>
              </div>

              <div style={{
                background: '#0f0f11', border: '1px solid #27272a', borderRadius: '2px',
                padding: '14px', marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: '#71717a', fontSize: '12px' }}>File</span>
                  <span style={{ color: '#fff', fontSize: '13px', fontWeight: '600' }}>
                    {decryptedFile.name || 'download'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#71717a', fontSize: '12px' }}>Type</span>
                  <span style={{ color: '#d4d4d8', fontSize: '13px' }}>
                    {decryptedFile.type || 'unknown'}
                  </span>
                </div>
              </div>

              <a
                href={decryptedFile.url}
                download={decryptedFile.name || 'download'}
                style={{
                  display: 'block', width: '100%', padding: '12px', borderRadius: '2px',
                  background: '#c53400', color: '#fff', border: 'none',
                  cursor: 'pointer', fontSize: '14px', fontWeight: '600',
                  textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box'
                }}
              >
                Download File
              </a>
            </div>
          )}

          {/* Already Claimed — allow download with claim secret — only for file vaults */}
          {!isInvite && vaultInfo?.isClaimed && claimStatus !== 'claimed' && (
            <div style={{
              background: '#18181b', border: '1px solid #27272a', borderRadius: '12px',
              padding: '20px', marginBottom: '20px'
            }}>
              <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔓</div>
                <h3 style={{ color: '#fff', fontSize: '16px', marginBottom: '4px' }}>Vault Already Claimed</h3>
                <p style={{ color: '#71717a', fontSize: '13px' }}>
                  Enter your claim secret to download the decrypted file.
                </p>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ color: '#71717a', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Claim Secret
                </label>
                <input
                  type="text"
                  value={claimSecret}
                  onChange={(e) => setClaimSecret(e.target.value)}
                  placeholder="Enter claim secret (hex)"
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: '2px',
                    background: '#0f0f11', border: '1px solid #27272a',
                    color: '#fff', fontSize: '13px', fontFamily: 'monospace',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {error && (
                <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '12px' }}>{error}</div>
              )}

              <button
                onClick={handleDownloadOnly}
                disabled={!claimSecret || claimStatus === 'downloading' || claimStatus === 'decrypting'}
                style={{
                  width: '100%', padding: '12px', borderRadius: '2px',
                  background: claimStatus === 'downloading' || claimStatus === 'decrypting' ? '#27272a' : '#c53400',
                  color: '#fff', border: 'none',
                  cursor: claimStatus === 'downloading' || claimStatus === 'decrypting' ? 'not-allowed' : 'pointer',
                  fontSize: '14px', fontWeight: '600'
                }}
              >
                {claimStatus === 'downloading' ? 'Downloading...'
                  : claimStatus === 'decrypting' ? 'Decrypting...'
                  : 'Download Decrypted File'}
              </button>
            </div>
          )}

          {/* Invite already claimed — still show joined state */}
          {isInvite && vaultInfo?.isClaimed && (
            <div style={{
              background: 'rgba(197,52,0,0.08)', border: '1px solid rgba(197,52,0,0.2)', borderRadius: '12px',
              padding: '20px', marginBottom: '20px', textAlign:'center'
            }}>
              <div style={{ fontSize:'24px', marginBottom:'8px' }}>🔗</div>
              <div style={{ color:'#c53400', fontSize:'14px', fontWeight:600 }}>Invite Already Claimed</div>
              <p style={{ color:'#71717a', fontSize:'12px', marginTop:'6px' }}>This invite vault has been claimed. {isPublicInvite ? 'You are joined.' : hasToken ? 'You have the required token — you are joined.' : 'Buy the token to retain access.'}</p>
            </div>
          )}

          {/* Back to Home */}
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'none', border: 'none', color: '#71717a',
                cursor: 'pointer', fontSize: '13px'
              }}
            >
              ← Back to Ownerz
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
