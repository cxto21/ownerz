/**
 * STRK20 private payments module for Ownerz.
 * Handles shield/unshield/private transfers via the Privacy Wallet API.
 * 
 * IMPORTANT: This dapp never touches viewing keys.
 * 
 * KEY INSIGHT: account.strk20InvokeTransaction() hangs forever for STRK20 txs
 * because it calls waitForTransaction() which can't see privacy txs on public RPC.
 * Solution: call wallet_strk20InvokeTransaction directly via walletV6.request().
 */

import { resolvePrivacyWallet, strk20InvokeViaWalletApi } from './starknet.js'

// STRK20 pool contract address (Sepolia testnet)
export const STRK20_POOL_ADDRESS = '0x0254a6b2997ef52e9f830ce1f543f6b29768295e8d17e2267d672c552cfe0d91'

// STRK token address (Sepolia testnet - same as mainnet per starter kit)
export const STRK_TOKEN_ADDRESS = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

/**
 * Register wallet in the STRK20 pool (SetViewingKey).
 * This must be done before any shield/transfer/withdraw operations.
 * The wallet generates a viewing keypair and publishes the public key on-chain.
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @returns {Promise<Object>} Transaction result
 */
export async function registerWallet(account) {
  try {
    console.log('Registering wallet in STRK20 pool...')
    
    const session = await resolvePrivacyWallet(account.address)
    if (!session?.account) {
      throw new Error('Could not connect to privacy wallet')
    }

    const actions = [
      {
        type: 'set_viewing_key'
      }
    ]
    
    console.log('Register wallet actions:', JSON.stringify(actions))
    const result = await strk20InvokeViaWalletApi(session.account, actions)
    console.log('Registration result:', result)
    
    if (result.pending) {
      return {
        success: false,
        pending: true,
        transactionHash: null,
        message: 'Registration submitted to wallet. Check explorer for status.'
      }
    }
    
    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Wallet registered successfully'
    }
  } catch (error) {
    console.error('Registration failed:', error)
    console.error('Registration error details:', {
      message: error.message,
      code: error.code,
      data: error.data
    })
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to register wallet'
    }
  }
}

/**
 * Convert decimal amount to hex (smallest unit).
 * STRK has 18 decimals.
 * @param {number|string} amount - Amount in STRK (e.g., "1.5")
 * @returns {string} Hex string in smallest unit
 */
export function toSmallestUnit(amount) {
  const num = parseFloat(amount)
  const wei = BigInt(Math.round(num * 1e18))
  return '0x' + wei.toString(16)
}

/**
 * Convert hex amount to decimal.
 * @param {string} hexAmount - Hex string in smallest unit
 * @returns {string} Amount in STRK
 */
export function fromSmallestUnit(hexAmount) {
  const wei = BigInt(hexAmount)
  const strk = Number(wei) / 1e18
  return strk.toFixed(4)
}

/**
 * Shield tokens (deposit into privacy pool).
 * This is a TWO-transaction flow:
 * 1. ERC-20 approve (public)
 * 2. Pool deposit (private)
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - ERC-20 token to shield
 * @param {string} amount - Amount in smallest unit (hex)
 * @returns {Promise<Object>} Transaction result
 */
export async function shieldTokens(account, tokenAddress, amount) {
  try {
    console.log('Shield attempt:', { tokenAddress, amount })
    
    // Get fresh wallet account for STRK20 transaction
    const session = await resolvePrivacyWallet(account.address)
    if (!session?.account) {
      throw new Error('Could not connect to privacy wallet')
    }
    
    const actions = [
      {
        type: 'deposit',
        token: tokenAddress,
        amount: amount
      }
    ]
    
    console.log('Shield actions:', JSON.stringify(actions))
    
    // Call via WalletAccountV6.strk20InvokeTransaction (with timeout handling)
    const result = await strk20InvokeViaWalletApi(session.account, actions)
    
    console.log('Shield result:', result)
    
    if (result.pending) {
      return {
        success: false,
        pending: true,
        transactionHash: null,
        message: 'Shield submitted to wallet. Check explorer for status.'
      }
    }
    
    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Tokens shielded successfully'
    }
  } catch (error) {
    console.error('Shield failed:', error)
    console.error('Shield error details:', {
      message: error.message,
      code: error.code,
      data: error.data,
      stack: error.stack
    })
    
    if (error.cause) {
      console.error('Error cause:', error.cause)
    }
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to shield tokens'
    }
  }
}

/**
 * Private transfer (inside the pool).
 * Both sender and recipient must be registered in the pool.
 * Registration happens automatically on first use.
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token to transfer
 * @param {string} amount - Amount in smallest unit (hex)
 * @param {string} recipientAddress - Recipient's Starknet address
 * @returns {Promise<Object>} Transaction result
 */
export async function privateTransfer(account, tokenAddress, amount, recipientAddress) {
  try {
    console.log('Private transfer attempt:', { tokenAddress, amount, recipientAddress })
    
    // Get fresh wallet account for STRK20 transaction
    const session = await resolvePrivacyWallet(account.address)
    if (!session?.account) {
      throw new Error('Could not connect to privacy wallet')
    }
    
    const actions = [
      {
        type: 'transfer',
        token: tokenAddress,
        amount: amount,
        recipient: recipientAddress
      }
    ]
    
    console.log('Transfer actions:', JSON.stringify(actions))
    
    // Call via WalletAccountV6.strk20InvokeTransaction (with timeout handling)
    const result = await strk20InvokeViaWalletApi(session.account, actions)
    
    console.log('Private transfer result:', result)
    
    // Handle pending case (wallet timeout — tx likely submitted on-chain)
    if (result.pending) {
      return {
        success: false,
        pending: true,
        transactionHash: null,
        message: 'Transaction submitted to wallet. Check explorer for status.'
      }
    }
    
    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Private transfer sent'
    }
  } catch (error) {
    console.error('Private transfer failed:', error)
    console.error('Transfer error details:', {
      message: error.message,
      code: error.code,
      data: error.data
    })
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to send private transfer'
    }
  }
}

/**
 * Batch private transfers (multiple recipients in one ZK proof).
 * More efficient than multiple single transfers - one proof, one wallet confirmation.
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token to transfer
 * @param {Array<{amount: string, recipient: string}>} transfers - Array of { amount, recipient }
 * @returns {Promise<Object>} Transaction result
 */
export async function batchPrivateTransfer(account, tokenAddress, transfers) {
  try {
    // Get fresh wallet account for STRK20 transaction
    const session = await resolvePrivacyWallet(account.address)
    if (!session?.account) {
      throw new Error('Could not connect to privacy wallet')
    }
    
    const actions = transfers.map(({ amount, recipient }) => ({
      type: 'transfer',
      token: tokenAddress,
      amount: amount,
      recipient: recipient
    }))
    
    console.log('Batch transfer actions:', JSON.stringify(actions))
    
    // Call via WalletAccountV6.strk20InvokeTransaction (with timeout handling)
    const result = await strk20InvokeViaWalletApi(session.account, actions)
    
    console.log('Batch transfer result:', result)
    
    if (result.pending) {
      return {
        success: false,
        pending: true,
        transactionHash: null,
        message: 'Batch transfer submitted to wallet. Check explorer for status.'
      }
    }
    
    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Batch private transfer sent'
    }
  } catch (error) {
    console.error('Batch transfer failed:', error)
    console.error('Batch transfer error details:', {
      message: error.message,
      code: error.code,
      data: error.data
    })
    
    return {
      success: false,
      error: error.message,
      message: 'Failed to send batch private transfer'
    }
  }
}

/**
 * Unshield tokens (withdraw from pool to public balance).
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token to unshield
 * @param {string} amount - Amount in smallest unit (hex)
 * @param {string} recipientAddress - Recipient's public address (optional, defaults to self)
 * @returns {Promise<Object>} Transaction result
 */
export async function unshieldTokens(account, tokenAddress, amount, recipientAddress) {
  try {
    const session = await resolvePrivacyWallet(account.address)
    if (!session?.account) {
      throw new Error('Could not connect to privacy wallet')
    }

    const actions = [
      {
        type: 'withdraw',
        token: tokenAddress,
        amount: amount,
        recipient: recipientAddress || account.address
      }
    ]

    console.log('Unshield actions:', JSON.stringify(actions))
    const result = await strk20InvokeViaWalletApi(session.account, actions)

    if (result.pending) {
      return {
        success: false,
        pending: true,
        transactionHash: null,
        message: 'Unshield submitted to wallet. Check explorer for status.'
      }
    }

    return {
      success: true,
      transactionHash: result.transaction_hash,
      message: 'Tokens unshielded successfully'
    }
  } catch (error) {
    console.error('Unshield failed:', error)
    console.error('Unshield error details:', {
      message: error.message,
      code: error.code,
      data: error.data
    })

    return {
      success: false,
      error: error.message,
      message: 'Failed to unshield tokens'
    }
  }
}

/**
 * Get STRK20 balance (shielded balance).
 * This requires wallet consent - only call when showing user their balance.
 * 
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token address to check
 * @returns {Promise<Object>} Balance info
 */
export async function getStrk20Balance(account, tokenAddress) {
  try {
    const balances = await account.strk20Balances([tokenAddress])
    return {
      success: true,
      balance: balances[0]?.balance || '0x0',
      balanceFormatted: fromSmallestUnit(balances[0]?.balance || '0x0')
    }
  } catch (error) {
    console.error('Balance check failed:', error)
    return {
      success: false,
      error: error.message,
      balance: '0x0',
      balanceFormatted: '0.0000'
    }
  }
}

/**
 * Check if wallet supports STRK20 and has required capabilities.
 * @param {Object} account - WalletAccountV6 instance
 * @returns {Promise<Object>} Capability check result
 */
export async function checkStrk20Capabilities(account) {
  try {
    // Try to get balances as a capability check
    // This will prompt wallet consent - only use when needed
    const hasStrk20 = typeof account.strk20InvokeTransaction === 'function'
    const hasBalances = typeof account.strk20Balances === 'function'
    
    return {
      success: true,
      hasStrk20,
      hasBalances,
      message: hasStrk20 ? 'STRK20 supported' : 'STRK20 not supported'
    }
  } catch (error) {
    return {
      success: false,
      hasStrk20: false,
      hasBalances: false,
      message: 'Could not check STRK20 capabilities'
    }
  }
}

/**
 * Format transaction hash for display.
 * @param {string} hash - Transaction hash
 * @returns {string} Truncated hash for display
 */
export function formatTxHash(hash) {
  if (!hash) return ''
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

/**
 * Get block explorer URL for transaction.
 * @param {string} txHash - Transaction hash
 * @returns {string} Explorer URL
 */
export function getExplorerUrl(txHash) {
  return `https://sepolia.voyager.online/tx/${txHash}`
}

/**
 * Check shielded (private) balance via the wallet.
 * @param {Object} account - WalletAccountV6 instance
 * @param {string} tokenAddress - Token to check balance for
 * @returns {Promise<Object>} Balance info
 */
export async function getShieldedBalance(account, tokenAddress) {
  try {
    console.log('Checking shielded balance for:', tokenAddress)
    const balances = await account.strk20Balances([tokenAddress])
    console.log('Shielded balances:', balances)
    
    if (balances && balances.length > 0) {
      const bal = balances.find(b => b.token.toLowerCase() === tokenAddress.toLowerCase())
      return {
        success: true,
        balance: bal ? bal.balance : '0',
        message: bal ? `Shielded: ${fromSmallestUnit(bal.balance)} STRK` : 'No shielded balance'
      }
    }
    return {
      success: true,
      balance: '0',
      message: 'No shielded balance'
    }
  } catch (error) {
    console.error('Failed to check shielded balance:', error)
    return {
      success: false,
      error: error.message,
      message: 'Could not check shielded balance'
    }
  }
}
