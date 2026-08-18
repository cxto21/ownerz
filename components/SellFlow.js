import { useState, useEffect } from 'react'
import { encryptData, generateKeyPair, wrapKeySeed } from '../lib/encryption'
import { calculateUploadFee } from '../lib/fees'
import { createVault, getVault, cidToFelt, getPlatformFee } from '../lib/filevault'
import { hash as snHash } from 'starknet'
import { getFileIcon, formatSize, copyToClipboard } from './utils'

const computePedersenHash = snHash.computePedersenHash

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

    // One unified flow: encrypt → upload to S3 → create vault (fee pulled by contract)
    setStep(1) // Encrypting & uploading
    setError(null)

    try {
      // Step 1: Encrypt and upload to S3
      const buffer = await file.arrayBuffer()
      const keypair = generateKeyPair()
      const { encrypted, secretKey } = await encryptData(buffer, {
        name: file.name,
        type: file.type,
      }, keypair)

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
      if (!data.success) throw new Error(data.error)

      // Step 2: Create vault on-chain (single tx = approve fee + create vault)
      setStep(2)
      const cid = data.cid
      const cidF = await cidToFelt(cid)

      const claimSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      const keySeedCiphertext = await wrapKeySeed(secretKey, claimSecret)

      const claimSecretNum = parseInt(claimSecret.slice(0, 4), 16)
      const high = (claimSecretNum >> 8) & 0xFF
      const low = claimSecretNum & 0xFF
      const inner = computePedersenHash(cidF, '0x' + high.toString(16).padStart(2, '0'))
      const commitment = computePedersenHash(inner, '0x' + low.toString(16).padStart(2, '0'))

      const keySeedBytes = new TextEncoder().encode(keySeedCiphertext)
      const keySeedHash = await crypto.subtle.digest('SHA-256', keySeedBytes)
      const keySeedHashHex = '0x' + Array.from(new Uint8Array(keySeedHash)).slice(0, 31).map(b => b.toString(16).padStart(2, '0')).join('')

      const priceWei = BigInt(Math.floor(parseFloat(price) * 1e18))

      // Get platform fee from contract
      const platformFee = await getPlatformFee()

      // Single multicall: STRK approve + create_vault (one wallet popup)
      const vaultResult = await createVault(account, {
        cid: cidF,
        price: priceWei,
        keySeedCiphertext: keySeedHashHex,
        commitment,
        ttl: 2592000,
        fee: platformFee,
      })

      // Upload full key seed to S3
      const keySeedS3Key = cid + '.key'
      await fetch('/api/upload-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: keySeedS3Key, data: keySeedCiphertext }),
      })

      // Wait for tx confirmation
      if (vaultResult?.transaction_hash) {
        try {
          await account.provider.waitForTransaction(vaultResult.transaction_hash, { timeout: 60000 })
        } catch (waitErr) {
          console.warn('waitForTransaction failed:', waitErr.message)
          const verifyVault = await getVault(account, cidF)
          if (!verifyVault) {
            throw new Error('Transaction may have failed on-chain. Please try again.')
          }
        }
      }

      setCidFelt(cidF)
      setResult({ ...data, claimSecret })
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

  return (
    <>
      {/* Progress */}
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
