import { useState } from 'react'
import { shieldTokens, getShieldedBalance, STRK_TOKEN_ADDRESS, getExplorerUrl } from '../lib/strk20-payments'

export default function ShieldModal({ account, onClose }) {
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState(0)
  const [error, setError] = useState(null)
  const [txHash, setTxHash] = useState(null)
  const [shieldedBalance, setShieldedBalance] = useState(null)

  const handleShield = async () => {
    if (!amount || !account) return
    setStep(1)
    setError(null)
    setShieldedBalance(null)

    try {
      const amountNum = parseFloat(amount)
      if (amountNum <= 0) throw new Error('Amount must be greater than 0')
      if (amountNum < 6) throw new Error('Minimum shield amount is 6 STRK')
      
      // Convert to hex (18 decimals)
      const amountHex = '0x' + BigInt(Math.round(amountNum * 1e18)).toString(16)
      
      const result = await shieldTokens(account, STRK_TOKEN_ADDRESS, amountHex)
      
      if (result.success) {
        setTxHash(result.transactionHash)
        // If timeout, show "possibly completed" state
        if (result.timeout) {
          setStep(3)
        } else {
          setStep(2)
        }
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      // If it's a timeout error, the shield may have worked anyway
      if (err.message && err.message.includes('timeout')) {
        console.log('Wallet timeout - shield may have succeeded, checking balance...')
        setStep(3) // "possibly completed" state
      } else {
        setError(err.message)
        setStep(0)
      }
    }
  }

  const checkShieldedBalance = async () => {
    try {
      const result = await getShieldedBalance(account, STRK_TOKEN_ADDRESS)
      if (result.success) {
        setShieldedBalance(result.message)
        if (result.balance && result.balance !== '0') {
          setStep(2) // Show success
          setTxHash(null) // No tx hash available
        }
      }
    } catch (err) {
      console.error('Balance check failed:', err)
    }
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="dv-card" style={{ maxWidth: '400px', width: '100%' }}>
        <div className="dv-card-content">
          {step === 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="dv-title">Shield STRK</h3>
                <button 
                  onClick={onClose}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: 'rgba(255,255,255,0.5)',
                    cursor: 'pointer',
                    fontSize: '20px'
                  }}
                >
                  ✕
                </button>
              </div>
              
              <p className="dv-hint">
                Deposit STRK into the privacy pool. Once shielded, you can make private transfers.
              </p>

              <div className="dv-input-group">
                <label>Amount (STRK)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="6.00"
                  min="6"
                  step="0.1"
                />
                <small>Minimum 6 STRK. Your wallet must be verified (Settings → Verify Account).</small>
              </div>

              <div className="dv-warning-box">
                <p>
                  ⚠️ You will need to approve <strong>TWO transactions</strong> in your wallet:
                </p>
                <ol>
                  <li>First: Approve the token spend (ERC-20 approve)</li>
                  <li>Second: Confirm the deposit to the pool</li>
                </ol>
              </div>

              {error && <div className="dv-error">{error}</div>}

              <button
                className="dv-btn-primary"
                onClick={handleShield}
                disabled={!amount}
              >
                Shield {amount || '0'} STRK
              </button>
            </>
          )}

          {step === 1 && (
            <div className="dv-loading">
              <div className="dv-spinner"></div>
              <p>Depositing to privacy pool...</p>
              <small style={{color: 'rgba(255,255,255,0.4)', marginTop: '8px'}}>
                Please approve both transactions in your wallet. The second one may take ~30 seconds for proof generation.
              </small>
            </div>
          )}

          {step === 2 && (
            <>
              <h3 className="dv-title">Shielded!</h3>
              
              <div className="dv-success-box">
                <p style={{color: 'var(--secondary-container)', marginBottom: '8px'}}>
                  {amount} STRK deposited to privacy pool
                </p>
                {txHash && (
                  <a 
                    href={getExplorerUrl(txHash)} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{color: 'var(--primary)', fontSize: '12px'}}
                  >
                    View on Explorer →
                  </a>
                )}
                {shieldedBalance && (
                  <p style={{color: 'var(--secondary-container)', marginTop: '8px', fontSize: '12px'}}>
                    {shieldedBalance}
                  </p>
                )}
              </div>

              <p className="dv-hint">
                You can now make private transfers and pay fees privately.
              </p>

              <div className="dv-info-tip">
                <p>
                  ⏱️ Note: Shielded funds take ~10 blocks (~20 minutes) to mature before they can be used for transfers.
                </p>
              </div>

              <button className="dv-btn-primary" onClick={onClose}>
                Done
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h3 className="dv-title">Processing...</h3>
              
              <div className="dv-loading">
                <p style={{color: 'var(--secondary-container)', marginBottom: '16px'}}>
                  The wallet didn't confirm, but your shield may have succeeded.
                </p>
                
                {shieldedBalance && (
                  <p style={{color: 'var(--secondary-container)', marginBottom: '16px'}}>
                    {shieldedBalance}
                  </p>
                )}
                
                <button 
                  className="dv-btn-secondary"
                  onClick={checkShieldedBalance}
                  style={{marginBottom: '12px'}}
                >
                  Check Shielded Balance
                </button>
                
                <button className="dv-btn-primary" onClick={onClose}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
