import { useState } from 'react'
import { deploy } from '../lib/ownerz/key-onchain-config.js'

export default function DeploySection({ account, refreshWallet }) {
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(false)
  const [error, setError] = useState(null)
  const [contractAddress, setContractAddress] = useState('')
  const [kexAddress, setKexAddress] = useState('')

  const handleDeploy = async () => {
    setDeploying(true)
    setError(null)

    try {
      // deploy() for v2 throws with instructions to use scripts/deploy.js
      // We catch and show the message, while also attempting to guide.
      const address = await deploy(account)
      // If future provider implements browser dual-deploy, it returns { fileVault, kex }
      if (address && typeof address === 'object' && address.fileVault) {
        setContractAddress(address.fileVault)
        setKexAddress(address.kex || address.keyExchange)
        setDeployed(true)
        alert(
          `Contracts deployed!\n\nFileVault: ${address.fileVault}\nKeyExchange: ${address.kex}\n\nAdd to .env:\nNEXT_PUBLIC_FILEVAULT_ADDRESS=${address.fileVault}\nNEXT_PUBLIC_KEY_EXCHANGE_MOCKUP_ADDRESS=${address.kex}\n\nThen restart the dev server.`
        )
      } else {
        setContractAddress(address)
        setDeployed(true)
        alert(
          `Contract deployed!\n\nAddress: ${address}\n\nAdd this to your .env:\nNEXT_PUBLIC_FILEVAULT_ADDRESS=${address}\n\nThen restart the dev server.`
        )
      }
    } catch (err) {
      // For v2, expect instructions about scripts/deploy.js
      setError(err.message)
    } finally {
      setDeploying(false)
    }
  }

  if (deployed) {
    return (
      <div
        style={{
          padding: '20px',
          margin: '20px auto',
          maxWidth: '600px',
          background: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          borderRadius: '8px',
        }}
      >
        <h3 style={{ color: '#10b981', margin: '0 0 10px 0', fontSize: '14px' }}>✅ Contracts Deployed</h3>
        {kexAddress && (
          <>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>KeyExchangeMockup:</div>
            <code
              style={{
                display: 'block',
                padding: '10px',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '4px',
                fontSize: '13px',
                wordBreak: 'break-all',
                marginBottom: '12px',
              }}
            >
              {kexAddress}
            </code>
          </>
        )}
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', marginBottom: '4px' }}>FileVault:</div>
        <code
          style={{
            display: 'block',
            padding: '10px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: '4px',
            fontSize: '13px',
            wordBreak: 'break-all',
          }}
        >
          {contractAddress}
        </code>
        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginTop: '12px' }}>
          Add both to .env and restart dev server. See scripts/deploy.js for Sepolia steps.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        padding: '20px',
        margin: '20px auto',
        maxWidth: '600px',
        background: 'rgba(139, 92, 246, 0.1)',
        border: '1px dashed rgba(139, 92, 246, 0.3)',
        borderRadius: '8px',
        textAlign: 'center',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: '0 0 12px 0' }}>
        FileVault v2 not deployed — requires KeyExchangeMockup + FileVault
      </p>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: '0 0 12px 0' }}>
        For Sepolia: <code>node scripts/deploy.js --private-key 0x... --account 0x...</code>
        <br />
        This deploys KEX first, then FileVault with KEX address. See scripts/deploy.js comments.
      </p>

      {error && (
        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '12px', whiteSpace: 'pre-wrap', textAlign: 'left', background: 'rgba(239,68,68,0.1)', padding: '10px', borderRadius: '4px' }}>
          {error}
        </div>
      )}

      <button
        onClick={handleDeploy}
        disabled={deploying}
        style={{
          padding: '10px 20px',
          background: deploying ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.8)',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: deploying ? 'wait' : 'pointer',
          fontSize: '13px',
          fontWeight: '600',
        }}
      >
        {deploying ? 'Deploying...' : 'Deploy FileVault v2 (guides to script)'}
      </button>
    </div>
  )
}
