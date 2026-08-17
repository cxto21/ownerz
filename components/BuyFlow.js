import { useState } from 'react'
import { decryptData, unwrapKeySeed, hexToArray } from '../lib/encryption'
import { batchPrivateTransfer, STRK_TOKEN_ADDRESS, formatTxHash, getExplorerUrl } from '../lib/strk20-payments'
import { cidToFelt, getVault, claimVault } from '../lib/filevault'
import { copyToClipboard } from './utils'

export default function BuyFlow({ connected, isStrk20, account, refreshWallet }) {
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

  return (
    <>
      {/* Progress */}
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

          {!txHash && account?.address && (
            <div className="dv-pending-box">
              Payment submitted via wallet. Your STRK20 transaction should appear here:
              <a 
                href={`https://sepolia.voyager.online/contract/${account.address}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Voyager →
              </a>
              <small>
                Note: STRK20 privacy transactions show as pool interactions — amounts and recipients are hidden by design.
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
