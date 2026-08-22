import { useState, useEffect } from 'react'
import { generateListing, lock, readLock, getFee, identifierToFelt, computeCommitment } from '../lib/key-onchain/index.js'
import { uploadEncryptedFile, uploadKeySeed } from '../lib/storage/index.js'
import { calculateUploadFee } from '../lib/fees'
import { getFileIcon, formatSize, copyToClipboard } from './utils'

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

    setStep(1)
    setError(null)

    try {
      // Step 1: Generate claim secret
      const claimSecret = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')

      // Step 2: Generate listing payload (encrypt + wrap key — single keypair!)
      // We generate once with pending CID, then recompute commitment for actual CID
      // to avoid double-keypair bug (previous version generated 2 different keypairs)
      const listing = await generateListing({
        file,
        fileName: file.name,
        fileType: file.type,
        cid: 'pending',
        claimSecret,
      })

      // Step 3: Upload encrypted file (server generates final CID)
      const uploadResult = await uploadEncryptedFile('pending', listing.encrypted, file.name)
      const cid = uploadResult.cid || uploadResult.key
      if (!cid || cid === 'pending') throw new Error('Upload failed to return CID')

      // Step 4: Recompute commitment for actual CID — REUSE same encrypted/keySeed!
      // Do NOT call generateListing again (that would create new keypair and break decrypt)
      const identifier = await identifierToFelt(cid)
      const commitment = computeCommitment(identifier, claimSecret)
      const integrityHash = listing.integrityHash
      const keySeedCiphertext = listing.keySeedCiphertext

      // Step 5: Lock on-chain with recomputed commitment
      setStep(2)
      const priceWei = BigInt(Math.floor(parseFloat(price) * 1e18))
      const fee = await getFee()

      const lockResult = await lock({
        account,
        identifier,
        commitment,
        integrityHash,
        meta: { price: priceWei, ttl: 2592000, fee },
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
      setResult({ cid, claimSecret, fileName: file.name, fileSize: file.size })
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
