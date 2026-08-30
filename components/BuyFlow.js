import { useState } from 'react'
import { recoverListing, identifierToFelt, readLock } from '../lib/key-onchain/index.js'
import { batchPrivateTransfer, STRK_TOKEN_ADDRESS, formatTxHash, getExplorerUrl } from '../lib/strk20-payments'
import { copyToClipboard } from './utils'

export default function BuyFlow({ connected, isStrk20, account, refreshWallet, onConnect }) {
  const [cid, setCid] = useState('')
  const [step, setStep] = useState(0)
  const [claimSecret, setClaimSecret] = useState('')
  const [decryptedFile, setDecryptedFile] = useState(null)
  const [copied, setCopied] = useState(null)
  const [error, setError] = useState(null)
  const [txHash, setTxHash] = useState(null)
  const [fileMetadata, setFileMetadata] = useState(null)
  const [showPqcTip, setShowPqcTip] = useState(false)

  // Platform fee is now 1% splitted at purchase time — see handleStrk20Payment
  // Legacy constant kept for fallback display only
  const PLATFORM_FEE = '0xde0b6b3a7640000' // 1 STRK in hex (1e18) — deprecated, now 1%

  const handlePurchase = async () => {
    if (!cid) return
    setStep(1)
    setError(null)

    try {
      const identifier = await identifierToFelt(cid.trim())
      // FileVault v2: readLock returns (Vault, LockState) tuple via FileVault.get_vault
      // Normalized shape: { issuer, meta:{price,status}, isClaimed, is_claimed, commitment, integrityHash }
      const locked = await readLock(identifier)

      if (!locked) {
        throw new Error('No vault found for this CID. The file may not have been uploaded with FileVault.')
      }

      // Check both Vault.status and LockState.is_claimed (v2 dual state)
      const status = Number(locked.meta?.status ?? locked.vault?.status ?? 0)
      const isClaimed = locked.isClaimed ?? locked.is_claimed ?? locked.lock?.is_claimed ?? false
      if (status !== 0 || isClaimed) {
        // Show lock details for debugging
        const commitment = locked.commitment ?? locked.lock?.commitment ?? 'unknown'
        throw new Error(
          `This vault is no longer available (status=${status}, isClaimed=${isClaimed}, commitment=${String(commitment).slice(0, 10)}...)`
        )
      }

      const sellerAddress = locked.issuer ?? locked.seller ?? locked.vault?.seller
      const price = locked.meta?.price ?? locked.vault?.price ?? BigInt(0)
      const priceStr = (Number(price) / 1e18).toString()

      // Keep lock reference for claim step to show commitment/integrity
      const commitment = locked.commitment ?? locked.lock?.commitment
      const integrityHash = locked.integrityHash ?? locked.integrity_hash ?? locked.lock?.integrity_hash
      const pqc = locked.pqc ?? locked.meta?.pqc ?? locked.vault?.pqc ?? false
      const platformFeeBps = locked.platformFeeBps ?? locked.meta?.platformFeeBps ?? locked.vault?.platform_fee_bps ?? 100

      setFileMetadata({ sellerAddress, price: priceStr, commitment, integrityHash, isClaimed, status, pqc, platformFeeBps })
      setStep(2)
    } catch (err) {
      setError(err.message)
      setStep(0)
    }
  }

  const handleStrk20Payment = async () => {
    if (!account || !isStrk20 || !fileMetadata) return
    setStep(3)
    setError(null)

    try {
      const sellerAddress = fileMetadata.sellerAddress
      let sellerHex
      if (typeof sellerAddress === 'bigint') {
        sellerHex = '0x' + sellerAddress.toString(16).padStart(64, '0')
      } else if (typeof sellerAddress === 'string' && !sellerAddress.startsWith('0x')) {
        sellerHex = '0x' + BigInt(sellerAddress).toString(16).padStart(64, '0')
      } else {
        sellerHex = sellerAddress
      }
      const price = BigInt(Math.round(parseFloat(fileMetadata.price) * 1e18))
      const fee = price / 100n // 1%
      const toSeller = price - fee
      const priceHex = '0x' + price.toString(16)
      const feeHex = '0x' + fee.toString(16)
      const toSellerHex = '0x' + toSeller.toString(16)
      const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET

      // Buyer pays price, seller receives 99%, platform 1% — STRK20 private batch
      const transfers = []
      // Always include seller portion (99%)
      transfers.push({ amount: toSellerHex, recipient: sellerHex })
      if (platformWallet) {
        transfers.push({ amount: feeHex, recipient: platformWallet })
      } else {
        // No platform wallet configured — seller gets full price (fallback)
        console.warn('[BuyFlow] NEXT_PUBLIC_PLATFORM_WALLET not set — skipping platform fee, seller receives full price')
      }

      const result = await batchPrivateTransfer(
        account,
        STRK_TOKEN_ADDRESS,
        transfers
      )

      if (result.pending) {
        if (refreshWallet) await refreshWallet()
        setTxHash(null)
        setStep(4)
      } else if (result.success) {
        if (refreshWallet) await refreshWallet()
        setTxHash(result.transactionHash)
        setStep(4)
      } else {
        throw new Error(result.error || 'Payment failed')
      }
    } catch (err) {
      setError(err.message)
      setStep(2)
    }
  }

  const handleClaim = async () => {
    if (!cid || !claimSecret) return
    setStep(5)
    setError(null)

    try {
      const { data, fileName, fileType } = await recoverListing({
        cid: cid.trim(),
        claimSecret: claimSecret.trim(),
        account,
      })

      const blob = new Blob([data], { type: fileType })
      const url = URL.createObjectURL(blob)
      setDecryptedFile({ url, name: fileName })
      setStep(8)
    } catch (err) {
      // Handle FileVault v2 delegation error: INVALID_PROOF from KeyExchangeMockup
      let msg = err.message || String(err)
      if (msg.includes('INVALID_PROOF') || msg.includes('0x494e56414c49445f50524f4f46')) {
        msg = 'Invalid claim secret — INVALID_PROOF. Check the secret from the seller and try again.'
      } else if (msg.includes('ALREADY_CLAIMED')) {
        msg = 'Vault already claimed.'
      }
      setError(msg)
      setStep(4)
    }
  }

  const reset = () => {
    setCid('')
    setStep(0)
    setClaimSecret('')
    setDecryptedFile(null)
    setError(null)
    setTxHash(null)
    setFileMetadata(null)
  }

  return (
    <>
      <style>{`.dv-pqc-bubble:hover .dv-pqc-tooltip{opacity:1 !important; pointer-events:auto !important;}`}</style>
      {step > 0 && step < 8 && (
        <div className="dv-progress">
          <div className={`dv-progress-step ${step >= 2 ? 'done' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 3 ? 'done' : step === 2 ? 'active' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 4 ? 'done' : step === 3 ? 'active' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 6 ? 'done' : step >= 4 ? 'active' : ''}`}></div>
          <span className="dv-progress-label">
            {step <= 2 ? 'Verify' : step === 3 ? 'Paying' : step === 4 ? 'Claim' : step <= 6 ? 'Download' : 'Decrypt'}
          </span>
        </div>
      )}

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
            onClick={!connected ? onConnect : handlePurchase}
            disabled={connected && !cid}
          >
            {!connected ? 'Connect Wallet' : 'Purchase Access'}
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
          <div style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px', justifyContent:'flex-end'}}>
            <div className="dv-pqc-bubble" onClick={() => setShowPqcTip(!showPqcTip)} style={{position:'relative', display:'inline-flex', alignItems:'center', gap:'6px', fontSize:'13px', padding:'4px 8px', borderRadius:'999px', background: fileMetadata?.pqc ? 'rgba(112,145,255,0.10)' : 'rgba(239,68,68,0.12)', border: fileMetadata?.pqc ? '1px solid rgba(91,112,168,0.30)' : '1px solid rgba(239,68,68,0.25)', color: fileMetadata?.pqc ? 'rgba(153,176,255,.9)' : '#ef4444', cursor:'pointer'}}>
              <span style={{width:'6px', height:'6px', borderRadius:'50%', background: fileMetadata?.pqc ? 'rgba(153,176,255,.9)' : '#ef4444', display:'inline-block'}}></span>
              {fileMetadata?.pqc ? 'PQC secure' : 'Non-PQC creation'}
              <span style={{width:'14px', height:'14px', borderRadius:'50%', background: fileMetadata?.pqc ? 'rgba(112,145,255,0.12)' : 'rgba(239,68,68,0.15)', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'13px', fontWeight:'bold'}}>i</span>
              <div className="dv-pqc-tooltip" style={{position:'absolute', top:'calc(100% + 8px)', right:0, width:'280px', background:'#111827', border:'1px solid #1e293b', borderRadius:'8px', padding:'12px 14px', fontSize:'13px', lineHeight:'1.6', color:'#d1d5db', boxShadow:'0 8px 24px rgba(0,0,0,0.5)', opacity: showPqcTip ? 1 : 0, pointerEvents: showPqcTip ? 'auto' : 'none', transition:'opacity 0.15s', zIndex:10, textAlign:'left'}}>
                {fileMetadata?.pqc ? 'Your browser is using TLS 1.3 with end-to-end PQC (Post-Quantum Cryptography) active — your connection is quantum-safe.' : 'Update to a modern browser with TLS 1.3 to enable end-to-end PQC (Post-Quantum Cryptography) for your connection'}
              </div>
            </div>
          </div>
          <div>
            <h3 className="dv-title">File Found</h3>
            <p className="dv-hint">
              Review the details and pay to access the encrypted file.
            </p>
          </div>

          {fileMetadata && (
            <div className="dv-metadata-card">
              <div className="dv-metadata-row">
                <span className="dv-metadata-label">File</span>
                <span className="dv-metadata-value">{cid ? cid.slice(0, 20) + '...' : ''}</span>
              </div>
              <div className="dv-metadata-row">
                <span className="dv-metadata-label">Price</span>
                <span className="dv-metadata-value price">{fileMetadata.price} STRK</span>
              </div>
              <div className="dv-metadata-row">
                <span className="dv-metadata-label">Platform fee 1%</span>
                <span className="dv-metadata-value fee">{(parseFloat(fileMetadata.price || 0) * 0.01).toFixed(4)} STRK</span>
              </div>
              <div className="dv-metadata-row">
                <span className="dv-metadata-label">You pay</span>
                <span className="dv-metadata-value total">
                  {fileMetadata.price} STRK + gas
                </span>
              </div>
              <div className="dv-metadata-row">
                <span className="dv-metadata-label">Seller receives</span>
                <span className="dv-metadata-value" style={{color:'rgba(255,255,255,0.7)'}}>{(parseFloat(fileMetadata.price || 0) * 0.99).toFixed(4)} STRK (99%)</span>
              </div>
              {fileMetadata.commitment && (
                <>
                  <div className="dv-metadata-row">
                    <span className="dv-metadata-label">Lock</span>
                    <span className="dv-metadata-value" style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                      {fileMetadata.isClaimed ? 'claimed' : 'active'} · {String(fileMetadata.commitment).slice(0, 12)}...
                    </span>
                  </div>
                  {fileMetadata.integrityHash && (
                    <div className="dv-metadata-row">
                      <span className="dv-metadata-label">Integrity</span>
                      <span className="dv-metadata-value" style={{ fontSize: '13px', fontFamily: 'var(--font-mono)' }}>
                        {String(fileMetadata.integrityHash).slice(0, 12)}...
                      </span>
                    </div>
                  )}
                </>
              )}
              {/* PQC badge — non-modifiable source from edge TLS at creation */}
              <div className="dv-metadata-row">
                <span className="dv-metadata-label">Connection</span>
                <span className="dv-metadata-value" style={{ fontSize: '13px', fontWeight: 600, color: fileMetadata.pqc ? '#22c55e' : '#f59e0b' }}>
                  {fileMetadata.pqc ? '✓ Created over PQC' : '⚠ Created without PQC — HNDL risk'}
                </span>
              </div>
            </div>
          )}

          <p className="dv-hint" style={{fontSize:'13px',marginBottom:'12px'}}>
            You need at least {parseFloat(fileMetadata?.price || 0) + 6} STRK in your public balance 
            (to shield and pay). Then pay privately from the pool. Seller receives 99%, platform 1%.
          </p>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handleStrk20Payment}
          >
            Pay {fileMetadata?.price} STRK Privately
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
                <button className="dv-copy" onClick={() => copyToClipboard(txHash, 'tx', setCopied)}>
                  {copied === 'tx' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <code>{formatTxHash(txHash)}</code>
              <a 
                href={getExplorerUrl(txHash)} 
                target="_blank" 
                rel="noopener noreferrer"
                style={{color: 'var(--primary)', fontSize: '13px', marginTop: '8px', display: 'block'}}
              >
                View on Explorer →
              </a>
            </div>
          )}

          {!txHash && (
            <div className="dv-pending-box">
              Payment submitted via STRK20 privacy pool.
              <small style={{display:'block', marginTop:'8px', color:'rgba(255,255,255,0.6)'}}>
                Private transactions are hidden from public explorers by design.
                {/* TODO (tech debt): STRK20 txs are invisible on Voyager. Need alternative confirmation: poll shielded balance, check FileVault payment event, or STRK20 receipt via wallet API. */}
              </small>
            </div>
          )}

          <div className="dv-input-group">
            <label>Claim Secret (from seller)</label>
            <input
              type="text"
              value={claimSecret}
              onChange={(e) => setClaimSecret(e.target.value)}
              placeholder="Enter the claim secret..."
              style={{fontFamily: 'var(--font-mono)', fontSize: '13px'}}
            />
            <small>The seller shared this secret privately with you</small>
          </div>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handleClaim}
            disabled={!claimSecret}
          >
            Claim Key & Decrypt
          </button>
        </>
      )}

      {step === 5 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Claiming vault and downloading file...</p>
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
