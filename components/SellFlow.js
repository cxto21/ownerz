import { useState, useEffect } from 'react'
import { encryptData, generateKeyPair, wrapKeySeed } from '../lib/encryption'
import { privateTransfer, STRK_TOKEN_ADDRESS } from '../lib/strk20-payments'
import { calculateUploadFee } from '../lib/fees'
import { createVault, getVault, cidToFelt } from '../lib/filevault'
import { hash as snHash } from 'starknet'
import { getFileIcon, formatSize, copyToClipboard } from './utils'

const computePedersenHash = snHash.computePedersenHash

export default function SellFlow({ connected, isStrk20, account, refreshWallet }) {
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

  return (
    <>
      {/* Progress */}
      {step > 0 && step < 5 && (
        <div className="dv-progress">
          <div className={`dv-progress-step ${step >= 1 ? 'done' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 2 ? 'done' : step === 1 ? 'active' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 3 ? 'done' : step === 2 ? 'active' : ''}`}></div>
          <div className={`dv-progress-step ${step >= 4 ? 'done' : step === 3 ? 'active' : ''}`}></div>
          <span className="dv-progress-label">Step {Math.min(step, 4)} of 4</span>
        </div>
      )}

      {step === 0 && (
        <>
          <div>
            <h3 className="dv-title">Upload Your File</h3>
            <p className="dv-hint">Encrypted and uploaded to Fil One (Filecoin). Any file type works.</p>
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

          {/* Fee Display */}
          {feeInfo && (
            <div className="dv-fee-display">
              <div className="dv-fee-label">Upload Fee</div>
              <div className="dv-fee-amount">{feeInfo.feeFormatted} STRK</div>
              <div className="dv-fee-breakdown">
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
              <button className="dv-copy" onClick={() => copyToClipboard(result.cid, 'cid', setCopied)}>
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

          <button className="dv-btn-secondary" onClick={reset}>Upload Another</button>
        </>
      )}
    </>
  )
}
