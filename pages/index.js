import { useState, useEffect, useCallback } from 'react'
import { encryptData, generateKeyPair, decryptData } from '../lib/encryption'
import { getAvailableWallets, connectWallet, isStrk20Capable } from '../lib/starknet'
import { 
  privateTransfer, 
  toSmallestUnit, 
  fromSmallestUnit,
  STRK_TOKEN_ADDRESS,
  formatTxHash,
  getExplorerUrl
} from '../lib/strk20-payments'

export default function DataVault() {
  const [mode, setMode] = useState('sell')
  const [walletState, setWalletState] = useState({
    connected: false,
    account: null,
    address: '',
    isStrk20: false,
    loading: false,
    error: null
  })

  // Check for wallet on mount
  useEffect(() => {
    const checkWallet = async () => {
      const wallets = await getAvailableWallets()
      if (wallets.length === 0) {
        setWalletState(prev => ({ ...prev, error: 'No Starknet wallet detected' }))
      }
    }
    checkWallet()
  }, [])

  const handleConnect = async () => {
    setWalletState(prev => ({ ...prev, loading: true, error: null }))
    
    try {
      const wallets = await getAvailableWallets()
      
      if (wallets.length === 0) {
        throw new Error('No Starknet wallet found. Install Ready extension.')
      }
      
      // Use first available wallet (in production, let user choose)
      const wallet = wallets[0]
      const result = await connectWallet(wallet)
      
      setWalletState({
        connected: true,
        account: result.account,
        address: result.address,
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

  return (
    <div className="dv">
      {/* Navigation */}
      <nav className="dv-nav">
        <div className="dv-nav-inner">
          <div className="dv-logo">OWNERZ</div>
          {walletState.connected ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }}>
              {walletState.isStrk20 ? (
                <span style={{
                  padding: '4px 8px',
                  background: 'rgba(4, 251, 251, 0.2)',
                  color: 'var(--secondary-container)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  STRK20 Ready
                </span>
              ) : (
                <span style={{
                  padding: '4px 8px',
                  background: 'rgba(255, 180, 171, 0.2)',
                  color: 'var(--error)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  No STRK20
                </span>
              )}
              <div style={{
                padding: '8px 16px',
                border: '1px solid rgba(255,255,255,0.1)',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--secondary-container)'
              }}>
                {walletState.address.slice(0,6)}...{walletState.address.slice(-4)}
              </div>
            </div>
          ) : (
            <button 
              onClick={handleConnect}
              disabled={walletState.loading}
              style={{
                padding: '12px 32px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: walletState.loading ? 'rgba(255,255,255,0.1)' : 'transparent',
                color: 'white',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                cursor: walletState.loading ? 'wait' : 'pointer',
                transition: 'all 0.3s'
              }}
            >
              {walletState.loading ? 'Connecting...' : 'Connect Wallet ✦'}
            </button>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="dv-main">
        {/* Hero Section */}
        <section className="dv-hero">
          <div className="dv-hero-image">
            <img src="/images/brand-asset.png" alt="Ownerz Brand Asset" />
          </div>
          
          <div className="dv-hero-content">
            {/* Error Banner */}
            {walletState.error && (
              <div className="dv-error" style={{ marginBottom: '24px' }}>
                {walletState.error}
              </div>
            )}
            
            {/* STRK20 Warning */}
            {walletState.connected && !walletState.isStrk20 && (
              <div className="dv-info-box" style={{ marginBottom: '24px' }}>
                <strong>STRK20 not supported.</strong> Install Ready extension for private payments. 
                Current wallet: {walletState.address.slice(0,6)}...{walletState.address.slice(-4)}
              </div>
            )}
            
            <div className="dv-card">
              {/* Tabs */}
              <div className="dv-tabs">
                <button 
                  className={`dv-tab ${mode === 'sell' ? 'active' : ''}`}
                  onClick={() => setMode('sell')}
                >
                  Upload Data
                </button>
                <button 
                  className={`dv-tab ${mode === 'buy' ? 'active' : ''}`}
                  onClick={() => setMode('buy')}
                >
                  Access with CID
                </button>
              </div>

              {/* Card Content */}
              <div className="dv-card-content">
                {mode === 'sell' ? (
                  <SellFlow 
                    connected={walletState.connected} 
                    isStrk20={walletState.isStrk20}
                    account={walletState.account}
                  />
                ) : (
                  <BuyFlow 
                    connected={walletState.connected}
                    isStrk20={walletState.isStrk20}
                    account={walletState.account}
                  />
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="dv-footer">
        Phase 1: Direct CID — Maximum Privacy
      </footer>
    </div>
  )
}

function SellFlow({ connected, isStrk20, account }) {
  const [file, setFile] = useState(null)
  const [price, setPrice] = useState('')
  const [step, setStep] = useState(0)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(null)

  const handleUpload = async () => {
    if (!file || !price) return
    setStep(1)
    setError(null)

    try {
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
        }),
      })

      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      setResult({ ...data, secretKey })
      setStep(2)
    } catch (err) {
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
  }

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  function getFileIcon(mimeType) {
    if (!mimeType) return '📄'
    if (mimeType.startsWith('image/')) return '🖼️'
    if (mimeType.startsWith('video/')) return '🎬'
    if (mimeType.startsWith('audio/')) return '🎵'
    if (mimeType === 'application/pdf') return '📕'
    if (mimeType.includes('zip') || mimeType.includes('compressed')) return '📦'
    if (mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('xml')) return '📝'
    return '📄'
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <>
      {step === 0 && (
        <>
          <div>
            <h3 className="dv-title">Upload Your File</h3>
            <p className="dv-hint">Encrypted and uploaded to Fil One (Filecoin). Any file type works.</p>
          </div>
          
          <div className="dv-upload" onClick={() => document.getElementById('file-input').click()}>
            <input
              id="file-input"
              type="file"
              onChange={(e) => setFile(e.target.files[0])}
              style={{display: 'none'}}
            />
            {file ? (
              <div className="dv-file-info">
                <span className="dv-file-icon">{getFileIcon(file.type)}</span>
                <div>
                  <div className="dv-file-name">{file.name}</div>
                  <div className="dv-file-meta">{formatSize(file.size)} · {file.type || 'unknown'}</div>
                </div>
              </div>
            ) : (
              <p className="dv-hint">Drag a file or click to upload</p>
            )}
          </div>

          <div className="dv-input-group">
            <label>Price (STRK)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
            />
          </div>

          {error && <div className="dv-error">{error}</div>}

          <button
            className="dv-btn-primary"
            onClick={handleUpload}
            disabled={!file || !price || !connected}
          >
            {!connected ? 'Connect Wallet First' : 'Encrypt & Upload'}
          </button>
        </>
      )}

      {step === 1 && (
        <div className="dv-loading">
          <div className="dv-spinner"></div>
          <p>Encrypting and uploading to Fil One...</p>
        </div>
      )}

      {step === 2 && result && (
        <>
          <div>
            <h3 className="dv-title">File Uploaded</h3>
            <p className="dv-hint">Share this CID privately with your buyer. No public listing.</p>
          </div>
          
          <div className="dv-cid-box">
            <div className="dv-cid-header">
              <label>CID (share privately)</label>
              <button className="dv-copy" onClick={() => copyToClipboard(result.cid, 'cid')}>
                {copied === 'cid' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <code>{result.cid}</code>
          </div>

          <div className="dv-cid-box">
            <div className="dv-cid-header">
              <label>ML-KEM768 Secret Key (save this!)</label>
              <button className="dv-copy" onClick={() => copyToClipboard(result.secretKey, 'key')}>
                {copied === 'key' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <code className="dv-key">{result.secretKey}</code>
            <small style={{color: 'rgba(255,255,255,0.4)', marginTop: '8px', display: 'block'}}>
              This key is needed to decrypt. Save it or send to smart contract.
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

function BuyFlow({ connected, isStrk20, account }) {
  const [cid, setCid] = useState('')
  const [step, setStep] = useState(0)
  const [secretKey, setSecretKey] = useState('')
  const [objectKey, setObjectKey] = useState('')
  const [encryptedData, setEncryptedData] = useState(null)
  const [decryptedFile, setDecryptedFile] = useState(null)
  const [copied, setCopied] = useState(null)
  const [error, setError] = useState(null)
  const [txHash, setTxHash] = useState(null)

  const handlePurchase = async () => {
    if (!cid) return
    setStep(1)
    setError(null)

    try {
      // Simulate payment processing (will be real STRK20 in next step)
      await new Promise(r => setTimeout(r, 2000))
      setObjectKey(cid)
      setStep(2)
    } catch (err) {
      setError(err.message)
      setStep(0)
    }
  }

  const handleStrk20Payment = async () => {
    if (!account || !isStrk20) return
    setStep(3)
    setError(null)

    try {
      // In production: this would be a real private transfer
      // For now, simulate the payment flow
      const amount = '0x0' // Will be set from price
      const result = await privateTransfer(
        account,
        STRK_TOKEN_ADDRESS,
        amount,
        '0x0' // Seller address would come from contract
      )
      
      if (result.success) {
        setTxHash(result.transactionHash)
        setStep(4)
      } else {
        throw new Error(result.error)
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

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  function hexToArray(hex) {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16)
    }
    return bytes
  }

  return (
    <>
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
              placeholder="datavault/..."
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
          <p>Processing payment...</p>
        </div>
      )}

      {step === 2 && (
        <>
          <div>
            <h3 className="dv-title">Access Unlocked</h3>
            <p className="dv-hint">
              {isStrk20 
                ? 'Enter the secret key from the seller to decrypt the file.'
                : 'Enter the secret key from the seller to decrypt the file.'}
            </p>
          </div>

          <div className="dv-input-group">
            <label>ML-KEM768 Secret Key</label>
            <input
              type="text"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="Paste the full key from seller..."
              style={{fontFamily: 'var(--font-mono)', fontSize: '12px'}}
            />
            <small>The full key is generated on upload (~4800 hex chars)</small>
          </div>

          {error && <div className="dv-error">{error}</div>}

          {isStrk20 ? (
            <button
              className="dv-btn-primary"
              onClick={handleStrk20Payment}
              disabled={!secretKey}
            >
              Pay with STRK20 Privately
            </button>
          ) : (
            <button
              className="dv-btn-primary"
              onClick={handleDownload}
              disabled={!secretKey}
            >
              Download Encrypted
            </button>
          )}
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

      {step === 4 && txHash && (
        <>
          <div>
            <h3 className="dv-title">Payment Sent</h3>
            <p className="dv-hint">Private payment confirmed. Now download and decrypt.</p>
          </div>

          <div className="dv-cid-box">
            <div className="dv-cid-header">
              <label>Transaction Hash</label>
              <button className="dv-copy" onClick={() => copyToClipboard(txHash, 'tx')}>
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

          <button
            className="dv-btn-primary"
            onClick={handleDownload}
          >
            Download Encrypted
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
