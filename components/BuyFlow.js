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

  const PLATFORM_FEE = '0xde0b6b3a7640000' // 1 STRK in hex (1e18)

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

      setFileMetadata({ sellerAddress, price: priceStr, commitment, integrityHash, isClaimed, status })
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
      const priceHex = '0x' + (BigInt(Math.round(parseFloat(fileMetadata.price) * 1e18))).toString(16)
      const platformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET

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
                <span className="dv-metadata-label">Platform fee</span>
                <span className="dv-metadata-value fee">1 STRK</span>
              </div>
              <div className="dv-metadata-row">
                <span className="dv-metadata-label">Total to pay</span>
                <span className="dv-metadata-value total">
                  {parseFloat(fileMetadata.price || 0) + 1} STRK + gas
                </span>
              </div>
              {fileMetadata.commitment && (
                <>
                  <div className="dv-metadata-row">
                    <span className="dv-metadata-label">Lock</span>
                    <span className="dv-metadata-value" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                      {fileMetadata.isClaimed ? 'claimed' : 'active'} · {String(fileMetadata.commitment).slice(0, 12)}...
                    </span>
                  </div>
                  {fileMetadata.integrityHash && (
                    <div className="dv-metadata-row">
                      <span className="dv-metadata-label">Integrity</span>
                      <span className="dv-metadata-value" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                        {String(fileMetadata.integrityHash).slice(0, 12)}...
                      </span>
                    </div>
                  )}
                </>
              )}
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
                <button className="dv-copy" onClick={() => copyToClipboard(txHash, 'tx', setCopied)}>
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
