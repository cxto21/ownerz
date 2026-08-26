import { useState, useEffect } from 'react'
import { generateListing, lock, readLock, getFee, identifierToFelt, computeCommitment } from '../lib/key-onchain/index.js'
import { uploadEncryptedFile, uploadKeySeed } from '../lib/storage/index.js'
import { calculateUploadFee } from '../lib/fees'
import { getFileIcon, formatSize, copyToClipboard } from './utils'
import { getPqcCapability } from '../lib/pqc'

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

      // Step 5: Lock on-chain with recomputed commitment (include PQC from edge)
      setStep(2)
      const priceWei = BigInt(Math.floor(parseFloat(price) * 1e18))
      const fee = await getFee()
      const pqc = uploadResult.pqc ?? false

      const lockResult = await lock({
        account,
        identifier,
        commitment,
        integrityHash,
        meta: { price: priceWei, ttl: 2592000, fee, pqc },
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
      setResult({ cid, claimSecret, fileName: file.name, fileSize: file.size, pqc })
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
              <div style={{marginTop:'8px', fontSize:'12px', color:'rgba(255,255,255,0.7)', background:'rgba(255,255,255,0.06)', padding:'8px 10px', borderRadius:'8px'}}>
                Platform fee 1% — you will receive 99% ({(parseFloat(price) * 0.99).toFixed(4)} STRK). No gas included.
                <div style={{fontSize:'11px', color:'rgba(255,255,255,0.4)', marginTop:'2px'}}>
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
              <div className="dv-pqc-tooltip" style={{position:'absolute', top:'calc(100% + 8px)', right:0, width:'280px', background:'#111827', border:'1px solid #1e293b', borderRadius:'8px', padding:'12px 14px', fontSize:'13px', lineHeight:'1.6', color:'#d1d5db', boxShadow:'0 8px 24px rgba(0,0,0,0.5)', opacity: showPqcTip ? 1 : 0, pointerEvents: showPqcTip ? 'auto' : 'none', transition:'opacity 0.15s', zIndex:10, textAlign:'left'}}>
                {result.pqc ? 'This vault was created over a TLS 1.3 connection confirmed by the edge — quantum-safe against harvest-now-decrypt-later attacks.' : 'This vault was created without PQC protection (HNDL risk). New uploads from modern browsers are marked PQC secure.'}
              </div>
            </div>
          </div>
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
