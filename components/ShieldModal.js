import { useState } from 'react'
import { shieldTokens, STRK_TOKEN_ADDRESS } from '../lib/strk20-payments'

export default function ShieldModal({ account, onClose, onShieldComplete }) {
  const [amount, setAmount] = useState('')
  const [step, setStep] = useState(0)
  const [error, setError] = useState(null)

  const handleShield = async () => {
    if (!amount || !account) return
    setStep(1)
    setError(null)

    try {
      const amountNum = parseFloat(amount)
      if (amountNum <= 0) throw new Error('Amount must be greater than 0')
      if (amountNum < 6) throw new Error('Minimum shield amount is 6 STRK')
      
      const amountHex = '0x' + BigInt(Math.round(amountNum * 1e18)).toString(16)
      
      const result = await shieldTokens(account, STRK_TOKEN_ADDRESS, amountHex)
      
      if (result.success) {
        if (result.timeout) {
          // Timeout — tx likely submitted, open balance panel (it will poll)
          onShieldComplete ? onShieldComplete() : onClose()
        } else {
          // Success — open balance panel (it will poll)
          setStep(2)
          setTimeout(() => {
            onShieldComplete ? onShieldComplete() : onClose()
          }, 1500)
        }
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      if (err.message && err.message.includes('timeout')) {
        // Timeout in catch — same behavior
        onShieldComplete ? onShieldComplete() : onClose()
      } else {
        setError(err.message)
        setStep(0)
      }
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
            <div className="dv-loading">
              <div className="dv-spinner"></div>
              <p style={{color: 'var(--secondary-container)'}}>
                Shielded! Opening balance...
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
