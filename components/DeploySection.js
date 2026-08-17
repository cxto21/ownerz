import { useState } from 'react'
import { deployContract } from '../lib/filevault'

export default function DeploySection({ account, refreshWallet }) {
  const [deploying, setDeploying] = useState(false)
  const [deployed, setDeployed] = useState(false)
  const [error, setError] = useState(null)
  const [contractAddress, setContractAddress] = useState('')

  const handleDeploy = async () => {
    setDeploying(true)
    setError(null)

    try {
      const address = await deployContract(account)
      setContractAddress(address)
      setDeployed(true)
      
      // Show instructions to user
      alert(`Contract deployed!\n\nAddress: ${address}\n\nAdd this to your .env:\nNEXT_PUBLIC_FILEVAULT_ADDRESS=${address}\n\nThen restart the dev server.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setDeploying(false)
    }
  }

  if (deployed) {
    return (
      <div style={{
        padding: '20px',
        margin: '20px auto',
        maxWidth: '600px',
        background: 'rgba(16, 185, 129, 0.1)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
        borderRadius: '8px'
      }}>
        <h3 style={{color: '#10b981', margin: '0 0 10px 0', fontSize: '14px'}}>
          ✅ Contract Deployed
        </h3>
        <code style={{
          display: 'block',
          padding: '10px',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '4px',
          fontSize: '12px',
          wordBreak: 'break-all'
        }}>
          {contractAddress}
        </code>
      </div>
    )
  }

  return (
    <div style={{
      padding: '20px',
      margin: '20px auto',
      maxWidth: '600px',
      background: 'rgba(139, 92, 246, 0.1)',
      border: '1px dashed rgba(139, 92, 246, 0.3)',
      borderRadius: '8px',
      textAlign: 'center'
    }}>
      <p style={{color: 'rgba(255,255,255,0.6)', fontSize: '13px', margin: '0 0 12px 0'}}>
        FileVault contract not deployed yet
      </p>
      
      {error && (
        <div style={{color: '#ef4444', fontSize: '12px', marginBottom: '12px'}}>
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
          fontWeight: '600'
        }}
      >
        {deploying ? 'Deploying...' : 'Deploy FileVault Contract'}
      </button>
    </div>
  )
}
