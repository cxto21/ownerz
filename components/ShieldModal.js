import { useState } from 'react'
import { shieldTokens, STRK_TOKEN_ADDRESS } from '../lib/strk20-payments'

export default function ShieldModal({ account, onClose }) {
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
        // Done — close modal, user checks balance manually
        onClose()
      } else {
        throw new Error(result.error)
      }
    } catch (err) {
      if (err.message && err.message.includes('timeout')) {
        // Timeout — tx likely submitted, close anyway
        onClose()
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
      background: 'rgba(2,4,10,0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div className="dv-card" style={{
        maxWidth: '400px',
        width: '100%',
        background: 'linear-gradient(160deg, rgba(13,18,31,.88), rgba(5,8,18,.94))',
        border: '1px solid var(--blue-glow)',
        boxShadow: '0 0 34px rgba(112,145,255,.10)',
        clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
      }}>
        <div className="dv-card-content">
          {step === 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 className="dv-title" style={{ fontFamily: 'var(--mono)', letterSpacing: '0.10em' }}>Shield STRK</h3>
                <button 
                  onClick={onClose}
                  style={{ 
                    background: 'none', 
                    border: 'none', 
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '20px'
                  }}
                >
                  ✕
                </button>
              </div>
              
              <p className="dv-hint" style={{ fontFamily: 'var(--body)' }}>
                Deposit STRK into the privacy pool. Once shielded, you can make private transfers.
              </p>

              <div className="dv-input-group">
                <label style={{ fontFamily: 'var(--mono)', letterSpacing: '0.22em' }}>Amount (STRK)</label>
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
                Please approve both transactions in your wallet.
              </small>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
